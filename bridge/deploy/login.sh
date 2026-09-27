#!/usr/bin/env bash
# Log the bridge in to Zalo by QR code. Run locally, from the repo:
#
#   bash bridge/deploy/login.sh root@203.0.113.10 -i ~/.ssh/hausto_bridge_ed25519
#
# It starts the login on the server (src/login.ts, as the bridge user), then
# brings each QR code it makes down to this machine and opens it. Scan it with
# the Zalo app of the account the bridge should use - Zalo > the QR icon >
# scan - and confirm the login on that phone. The session is saved on the
# server only; nothing about it comes back here except "saved".
#
# Then run deploy.sh again to start the bridge.
set -uo pipefail

TARGET="${1:?usage: login.sh user@host [ssh options...]}"
shift
OPTS=(-o StrictHostKeyChecking=accept-new "$@")
QR_REMOTE=/opt/hausto-bridge/state/qr.png
LOCAL_DIR="$(mktemp -d)"
QR_LOCAL="$LOCAL_DIR/zalo-login-qr.png"
trap 'rm -rf "$LOCAL_DIR"' EXIT

open_image() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) cmd.exe //c start "" "$(cygpath -w "$1")" ;;
    Darwin) open "$1" ;;
    *) xdg-open "$1" >/dev/null 2>&1 || echo "[login] open $1 to see the QR code" ;;
  esac
}

echo "[login] starting the login on $TARGET..."
ssh "${OPTS[@]}" "$TARGET" 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo);
  $SUDO rm -f /opt/hausto-bridge/state/qr.png;
  cd /opt/hausto-bridge/app &&
  $SUDO runuser -u hausto -- env $(grep ^ZALO_CREDENTIALS_FILE= /opt/hausto-bridge/.env) \
    node --experimental-transform-types src/login.ts' &
LOGIN=$!

last=""
while kill -0 "$LOGIN" 2>/dev/null; do
  stamp="$(ssh "${OPTS[@]}" "$TARGET" "stat -c %Y $QR_REMOTE 2>/dev/null" 2>/dev/null || true)"
  if [ -n "$stamp" ] && [ "$stamp" != "$last" ]; then
    last="$stamp"
    if scp -q "${OPTS[@]}" "$TARGET:$QR_REMOTE" "$QR_LOCAL" 2>/dev/null; then
      open_image "$QR_LOCAL"
      echo "[login] the QR code is open on this screen - scan it now."
    fi
  fi
  sleep 3
done

wait "$LOGIN"
status=$?
if [ "$status" = 0 ]; then
  echo "[login] done. Start the bridge with: bash bridge/deploy/deploy.sh $TARGET $*"
fi
exit "$status"
