#!/usr/bin/env bash
# Explicit maintenance operation. Ordinary web deploys never call this script.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
BASE="${OMNIWALL_STATE_DIR:-$HOME/.omniwall/bluegreen}/runtime"
mkdir -p "$BASE/releases" "$HOME/.config/systemd/user"
exec 9>"$BASE/install.lock"
flock -n 9 || exit 1
if systemctl --user is-active --quiet omniwall-runtime.service; then
  echo 'Runtime is already active. Explicitly stop it during a maintenance window before upgrading.' >&2
  exit 1
fi
RELEASE="$BASE/releases/$(date +%Y%m%d%H%M%S)"
mkdir -p "$RELEASE"
# Snapshot source, not the database. Dependencies remain shared with this checkout.
tar -C "$ROOT/server" --exclude=node_modules --exclude=data --exclude=.env -cf - . | tar -C "$RELEASE" -xf -
ln -s "$ROOT/server/node_modules" "$RELEASE/node_modules"
ln -s "$ROOT/client" "$RELEASE/../client" 2>/dev/null || true
ln -sfn "$RELEASE" "$BASE/current"
cat > "$HOME/.config/systemd/user/omniwall-runtime.service" <<EOF
[Unit]
Description=OmniWall persistent API, terminals and background runtime
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT/server
ExecStart=/usr/bin/node $BASE/current/index.js
Environment=PORT=3103
Environment=HOST=127.0.0.1
Environment=NODE_ENV=production
Environment=DB_PATH=$ROOT/server/data/omniwall.db
EnvironmentFile=-$ROOT/server/.env
Restart=on-failure
RestartSec=3
KillMode=control-group

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now omniwall-runtime.service
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:3103/api/health >/dev/null; then
    echo 'Persistent runtime healthy on 3103.'; exit 0
  fi
  sleep 1
done
journalctl --user -u omniwall-runtime.service -n 40 --no-pager >&2
exit 1
