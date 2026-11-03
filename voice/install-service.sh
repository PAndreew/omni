#!/usr/bin/env bash
# Deploy Gizi alongside Omni's existing blue-green containers, without replacing
# their data or exposing Omni's terminal/control sockets to the phone view.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
STATE="$HOME/.config/omni-gizi"
UNITS="$HOME/.config/systemd/user"
PROXY="$HOME/.omniwall/bluegreen/Caddyfile"
mkdir -p "$STATE" "$UNITS"
chmod 700 "$STATE"
(cd "$ROOT/voice" && npm ci --ignore-scripts --workspaces=false)
(cd "$ROOT/client" && npm run build)
if [[ ! -e "$STATE/runtime.env" ]]; then
  printf '%s\n' 'GIZI_GCP_PROJECT=currentlyai' 'GIZI_GCP_LOCATION=eu' 'GIZI_TRANSCRIBE_MODEL=gemini-3.5-flash' 'GIZI_TTS_VOICE=hu-HU-Chirp3-HD-Aoede' 'GIZI_SESSION_SECONDS=120' 'GIZI_DAILY_SECONDS=1800' > "$STATE/runtime.env"
  chmod 600 "$STATE/runtime.env"
fi
cat > "$UNITS/omni-gizi.service" <<EOF
[Unit]
Description=Gizi recorded voice bridge (Gemini Transcribe to restricted Pi tools)
After=network-online.target omniwall-proxy.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT/voice
ExecStart=/usr/bin/node $ROOT/voice/server.js
Environment=GIZI_STATE_DIR=$STATE
Environment=CLOUDSDK_CORE_DISABLE_PROMPTS=1
Environment=CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1
EnvironmentFile=$STATE/runtime.env
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077
NoNewPrivileges=true
MemoryMax=768M
TasksMax=64

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now omni-gizi.service
systemctl --user restart omni-gizi.service
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:3002/gizi/status >/dev/null
if [[ ! -f "$PROXY" ]]; then
  echo "Existing Omni proxy configuration not found; voice is available on local port 3002." >&2
  exit 1
fi
# Keep a one-time rollback copy. Only UI/assets and /gizi are routed to the new
# service; original API and legacy sockets remain on the existing container.
[[ -e "$PROXY.before-gizi" ]] || cp "$PROXY" "$PROXY.before-gizi"
cat > "$PROXY.tmp" <<EOF
:3001 {
    @gizi_ui path / /index.html /assets/* /gizi/*
    handle @gizi_ui {
        reverse_proxy 127.0.0.1:3002
    }
    handle {
        import $HOME/.omniwall/bluegreen/upstream.caddy
    }
}
EOF
caddy validate --config "$PROXY.tmp" --adapter caddyfile
mv "$PROXY.tmp" "$PROXY"
if ! systemctl --user reload omniwall-proxy.service; then
  cp "$PROXY.before-gizi" "$PROXY"
  systemctl --user reload omniwall-proxy.service
  exit 1
fi
curl -fsS http://127.0.0.1:3001/gizi/status >/dev/null
# Add a new tailnet-only HTTPS port, preserving all existing Serve routes.
tailscale serve --bg --https=9443 http://127.0.0.1:3002
printf '\nGizi deployed. Voice key: %s/access-key\n' "$STATE"
printf 'Phone URL: https://raspberrypi.tailf0acdd.ts.net:9443/ (requires Tailscale)\n'
