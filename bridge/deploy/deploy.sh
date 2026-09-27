#!/usr/bin/env bash
# Copy the bridge to the VPS and (re)start it. Run from the repo, locally:
#
#   bash bridge/deploy/deploy.sh root@203.0.113.10           # first time and every update
#   bash bridge/deploy/deploy.sh root@203.0.113.10 --no-start # copy only
#
# The target is whatever admin login the provider gave you (root@..., or
# ubuntu@... with sudo). It copies the bridge's source - never node_modules,
# credentials.json or the journal - installs dependencies as the bridge user,
# installs the systemd unit, and restarts the service. Starting is skipped
# until the Zalo credentials are on the server, since without them the bridge
# can only fail.
set -euo pipefail

TARGET="${1:?usage: deploy.sh user@host [--no-start] [ssh options...]}"
shift
START=1
if [ "${1:-}" = "--no-start" ]; then START=0; shift; fi
SSH=(ssh -o StrictHostKeyChecking=accept-new "$@" "$TARGET")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE="$(cd "$HERE/.." && pwd)"

echo "[deploy] checking the server is provisioned..."
"${SSH[@]}" 'command -v node >/dev/null && node -e "process.exit(Number(process.versions.node.split(\".\")[0]) < 22 ? 1 : 0)" && id hausto >/dev/null' \
  || { echo "[deploy] Node 22 or the hausto user is missing - run bridge/deploy/provision.sh on it first (or create it with cloud-init.yaml)."; exit 1; }

echo "[deploy] copying the bridge..."
tar -C "$BRIDGE" -czf - \
  --exclude=node_modules --exclude=credentials.json --exclude=journal.jsonl --exclude=.env \
  package.json package-lock.json tsconfig.json README.md src deploy \
  | "${SSH[@]}" 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo);
      $SUDO rm -rf /opt/hausto-bridge/app.new && $SUDO install -d -o hausto -g hausto /opt/hausto-bridge/app.new &&
      $SUDO tar -xzf - -C /opt/hausto-bridge/app.new && $SUDO chown -R hausto:hausto /opt/hausto-bridge/app.new &&
      $SUDO rm -rf /opt/hausto-bridge/app && $SUDO mv /opt/hausto-bridge/app.new /opt/hausto-bridge/app'

echo "[deploy] installing dependencies and the service..."
"${SSH[@]}" 'set -e; SUDO=$([ "$(id -u)" = 0 ] || echo sudo);
  cd /opt/hausto-bridge/app && $SUDO runuser -u hausto -- env HOME=/opt/hausto-bridge npm ci --omit=dev --no-audit --no-fund;
  $SUDO bash /opt/hausto-bridge/app/deploy/init-env.sh;
  $SUDO install -m 0644 /opt/hausto-bridge/app/deploy/hausto-zalo-bridge.service /etc/systemd/system/hausto-zalo-bridge.service;
  $SUDO systemctl daemon-reload;
  $SUDO systemctl enable hausto-zalo-bridge >/dev/null'

if [ "$START" = 0 ]; then
  echo "[deploy] copied; not started (--no-start)."
  exit 0
fi

if ! "${SSH[@]}" 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo); $SUDO test -s /opt/hausto-bridge/state/credentials.json'; then
  cat <<MSG
[deploy] Copied, but not started: there is no Zalo login on the server yet.
         Put credentials.json there (bridge/README.md, "The Zalo session"), then run this again:

  scp credentials.json $TARGET:/tmp/credentials.json
  ssh $TARGET 'sudo install -o hausto -g hausto -m 600 /tmp/credentials.json /opt/hausto-bridge/state/credentials.json && rm /tmp/credentials.json'
MSG
  exit 0
fi

echo "[deploy] restarting..."
"${SSH[@]}" 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo); $SUDO systemctl restart hausto-zalo-bridge; sleep 5; $SUDO systemctl --no-pager --lines=15 status hausto-zalo-bridge || true'
echo "[deploy] done. Follow the logs with: ssh $TARGET 'sudo journalctl -u hausto-zalo-bridge -f'"
