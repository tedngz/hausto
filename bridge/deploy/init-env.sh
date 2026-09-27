#!/usr/bin/env bash
# Runs on the VPS, as root, from deploy.sh. Creates /opt/hausto-bridge/.env the
# first time - with a freshly generated ZALO_BRIDGE_TOKEN - and never touches
# it again after that.
#
# The token is generated here, on the server, so it is never typed, pasted
# into a chat, or stored in the repo. You read it from the server yourself and
# set it as the ZALO_BRIDGE_TOKEN secret in the Supabase dashboard.
set -euo pipefail

ENV_FILE=/opt/hausto-bridge/.env
DEVICE_LABEL="${1:-vps-$(hostname -s)}"

if [ -f "$ENV_FILE" ]; then
  echo "[init-env] $ENV_FILE already exists - leaving it alone."
  exit 0
fi

TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"

umask 077
cat > "$ENV_FILE" <<ENV
ZALO_BRIDGE_TOKEN=$TOKEN
ZALO_CREDENTIALS_FILE=/opt/hausto-bridge/state/credentials.json
JOURNAL_FILE=/opt/hausto-bridge/state/journal.jsonl
DEVICE_LABEL=$DEVICE_LABEL
DAILY_CAP=60
MIN_GAP_MS=20000
ENV
chown hausto:hausto "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Shown only on request: deploy.sh may be run by someone - or something - whose
# output is logged, and a token in a log is a token to rotate.
if [ "${SHOW_TOKEN:-0}" = 1 ]; then
  echo "ZALO_BRIDGE_TOKEN=$TOKEN"
else
  cat <<'MSG'

==================================================================
 A ZALO_BRIDGE_TOKEN was generated and stored in
 /opt/hausto-bridge/.env (readable by root and the bridge only).

 Show it on your own terminal, then set it as that edge-function
 secret in the Supabase dashboard:

   ssh -i ~/.ssh/hausto_bridge_ed25519 root@SERVER_IP \
     "grep ^ZALO_BRIDGE_TOKEN= /opt/hausto-bridge/.env | cut -d= -f2"
==================================================================

MSG
fi
