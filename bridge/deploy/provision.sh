#!/usr/bin/env bash
# Prepare a bare Ubuntu 24.04 server for the Zalo bridge, over SSH - for
# providers with no user-data / cloud-init field. Does what cloud-init.yaml
# does, and is safe to run again.
#
#   ssh -i ~/.ssh/hausto_bridge_ed25519 root@SERVER_IP 'bash -s' < bridge/deploy/provision.sh
#
# It hardens SSH to keys only. It refuses to do that unless the account it
# runs as already has an authorized key, so it cannot lock you out.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" = 0 ] || { echo "[provision] run as root"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "[provision] warning: written for Ubuntu 24.04, this is $PRETTY_NAME"

echo "[provision] packages and security updates..."
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg ufw unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "[provision] Node 22..."
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
node -v

echo "[provision] the bridge user and its directories..."
id hausto >/dev/null 2>&1 || useradd --system --home /opt/hausto-bridge --shell /usr/sbin/nologin hausto
install -d -o hausto -g hausto -m 0750 /opt/hausto-bridge
install -d -o hausto -g hausto -m 0750 /opt/hausto-bridge/app
install -d -o hausto -g hausto -m 0700 /opt/hausto-bridge/state

echo "[provision] SSH: keys only..."
if [ -s "$HOME/.ssh/authorized_keys" ]; then
  # 01- so it is read before the provider's 50-cloud-init.conf, which turns
  # passwords on: sshd keeps the first value it sees for each setting.
  cat > /etc/ssh/sshd_config.d/01-hausto.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t
  systemctl reload ssh
else
  echo "[provision] no authorized key for $(whoami) - leaving password logins on rather than locking you out"
fi

echo "[provision] firewall: SSH in, nothing else..."
SSH_PORT="$(sshd -T | awk '/^port /{p=$2} END{print p}')"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

echo "[provision] done."
