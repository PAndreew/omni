#!/usr/bin/env bash
# One-time, root-owned authorization for exactly one system service restart.
set -euo pipefail
if [ "$EUID" -ne 0 ]; then
  echo 'Run from a regular Pi terminal: sudo bash voice/install-spotify-controls.sh' >&2
  exit 1
fi
APP_USER=${SUDO_USER:-pi}
if [[ ! "$APP_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo 'Invalid application user.' >&2; exit 1
fi
id "$APP_USER" >/dev/null
if ! systemctl cat raspotify.service >/dev/null 2>&1; then
  echo 'raspotify.service must be installed first.' >&2; exit 1
fi
TEMP=$(mktemp)
trap 'rm -f "$TEMP"' EXIT
cat > "$TEMP" <<EOF
// Beezywall: authorize only restarting the Spotify client, never other units.
polkit.addRule(function(action, subject) {
    if (action.id === "org.freedesktop.systemd1.manage-units" &&
        action.lookup("unit") === "raspotify.service" &&
        action.lookup("verb") === "restart" &&
        subject.user === "$APP_USER") {
        return polkit.Result.YES;
    }
});
EOF
mkdir -p /etc/polkit-1/rules.d
install -o root -g root -m 0644 "$TEMP" /etc/polkit-1/rules.d/49-beezywall-spotify.rules
# Polkit watches its rules directory; no daemon/service restart is required.
echo "Installed: $APP_USER may restart only raspotify.service through systemd."
echo 'Try the Restart Spotify button in Beezywall. No general sudo permission was granted.'
