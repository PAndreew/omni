#!/usr/bin/env bash
# Build an inactive OmniWall slot, wait until it is healthy, then atomically
# switch Caddy to it. The currently live slot is untouched until cutover.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
STATE_DIR="${OMNIWALL_STATE_DIR:-$HOME/.omniwall/bluegreen}"
UNIT_DIR="$HOME/.config/systemd/user"
ACTIVE_FILE="$STATE_DIR/active-slot"
UPSTREAM_FILE="$STATE_DIR/upstream.caddy"
CADDYFILE="$STATE_DIR/Caddyfile"
PROXY_UNIT="$UNIT_DIR/omniwall-proxy.service"
KIOSK_OVERRIDE_DIR="$UNIT_DIR/omniwall-kiosk.service.d"
IMAGE="${OMNIWALL_IMAGE:-omniwall:$(date +%Y%m%d%H%M%S)}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

declare -A PORTS=( [blue]=3101 [green]=3102 )
mkdir -p "$STATE_DIR" "$UNIT_DIR" "$KIOSK_OVERRIDE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

# Containers use restart=unless-stopped, so ensure the daemon also returns
# after a Raspberry Pi reboot.
if ! systemctl is-enabled --quiet docker.service || ! systemctl is-active --quiet docker.service; then
  sudo systemctl enable --now docker.service
fi

active="$(cat "$ACTIVE_FILE" 2>/dev/null || true)"
if [[ -n "$active" && "$active" != blue && "$active" != green ]]; then
  echo 'Invalid active-slot state; refusing deployment.' >&2; exit 1
fi
if [[ "$active" == blue ]]; then
  candidate=green
else
  candidate=blue
fi
candidate_port="${PORTS[$candidate]}"
candidate_name="omniwall-$candidate"
old_name="${active:+omniwall-$active}"
old_port="${active:+${PORTS[$active]}}"

# A retired slot may still own WebSockets and terminals. Never kill it merely
# to make room for another build; an operator must drain/stop it first.
if [[ "$(docker inspect --format '{{.State.Running}}' "$candidate_name" 2>/dev/null || true)" == true ]]; then
  echo "$candidate_name is still running. Drain its sessions and stop it before reusing this slot." >&2
  exit 1
fi

# Runtime is installed separately, never restarted by web deploys.
curl -fsS http://127.0.0.1:3103/api/health >/dev/null || {
  echo 'Persistent runtime is not healthy. Run install-runtime.sh first.' >&2; exit 1;
}
echo "Building $IMAGE for the inactive $candidate slot..."
if [[ -z "${OMNIWALL_IMAGE:-}" ]]; then
  docker build --pull -t "$IMAGE" "$ROOT"
else
  docker image inspect "$IMAGE" >/dev/null
fi

docker rm -f "$candidate_name" >/dev/null 2>&1 || true
run_args=(
  run -d
  --name "$candidate_name"
  --restart unless-stopped
  --label omniwall.slot="$candidate"
  --label omniwall.role=web
  --label omniwall.image="$IMAGE"
  -p "127.0.0.1:${candidate_port}:3001"
  -e PORT=3001
  -e NODE_ENV=production
)
run_args+=("$IMAGE")
docker "${run_args[@]}" >/dev/null

echo "Waiting for $candidate_name to become healthy..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
while (( SECONDS < deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$candidate_name" 2>/dev/null || echo missing)"
  if [[ "$status" == healthy ]]; then
    curl -fsS "http://127.0.0.1:${candidate_port}/api/health" >/dev/null
    echo "$candidate_name is healthy."
    break
  fi
  if [[ "$status" == unhealthy || "$status" == missing ]]; then
    docker logs --tail 80 "$candidate_name" >&2 || true
    exit 1
  fi
  sleep 2
done

if [[ "${status:-}" != healthy ]]; then
  echo "Candidate did not become healthy within ${HEALTH_TIMEOUT}s." >&2
  docker logs --tail 80 "$candidate_name" >&2 || true
  exit 1
fi

if [[ -f "$UNIT_DIR/omni-gizi.service" ]]; then
  cat > "$CADDYFILE" <<EOF
:3001 {
    handle /gizi/* {
        reverse_proxy 127.0.0.1:3002 {
            stream_close_delay 24h
        }
    }
    @runtime path /api/* /socket.io/* /remote
    handle @runtime {
        reverse_proxy 127.0.0.1:3103 {
            stream_close_delay 24h
        }
    }
    handle {
        import $UPSTREAM_FILE
    }
}
EOF
else
  cat > "$CADDYFILE" <<EOF
:3001 {
    @runtime path /api/* /socket.io/* /remote
    handle @runtime {
        reverse_proxy 127.0.0.1:3103 {
            stream_close_delay 24h
        }
    }
    handle {
        import $UPSTREAM_FILE
    }
}
EOF
fi

cat > "$PROXY_UNIT" <<EOF
[Unit]
Description=OmniWall blue-green reverse proxy
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/caddy run --config=$CADDYFILE --adapter=caddyfile
ExecReload=/usr/bin/caddy reload --config=$CADDYFILE --adapter=caddyfile
Restart=on-failure
TimeoutStopSec=5s

[Install]
WantedBy=default.target
EOF

# Once containerized, the kiosk must depend on the stable proxy rather than
# restarting the retired bare-metal server. Update existing locally-installed
# units as systemd cannot reliably subtract a Wants= dependency in a drop-in.
if [[ -f "$UNIT_DIR/omniwall-kiosk.service" ]]; then
  sed -i 's/omniwall-server\.service/omniwall-proxy.service/g' "$UNIT_DIR/omniwall-kiosk.service"
fi
cat > "$KIOSK_OVERRIDE_DIR/blue-green.conf" <<EOF
[Unit]
Wants=
Wants=omniwall-proxy.service
After=
After=omniwall-proxy.service
EOF

previous_upstream=""
[[ -f "$UPSTREAM_FILE" ]] && previous_upstream="$(cat "$UPSTREAM_FILE")"
printf 'reverse_proxy 127.0.0.1:%s {\n    stream_close_delay 24h\n}\n' "$candidate_port" > "$UPSTREAM_FILE.tmp"
mv "$UPSTREAM_FILE.tmp" "$UPSTREAM_FILE"

if ! /usr/bin/caddy validate --config "$CADDYFILE" --adapter caddyfile; then
  printf '%s\n' "$previous_upstream" > "$UPSTREAM_FILE"
  exit 1
fi
systemctl --user daemon-reload
if systemctl --user is-active --quiet omniwall-server.service; then
  # First container deployment: candidate is already healthy before the old
  # bare-metal server releases the public port. Disable it so Restart=always
  # and the kiosk's former dependency cannot bring it back after cutover.
  systemctl --user disable --now omniwall-server.service
fi

if systemctl --user is-active --quiet omniwall-proxy.service; then
  if ! systemctl --user reload omniwall-proxy.service; then
    printf '%s\n' "$previous_upstream" > "$UPSTREAM_FILE"
    exit 1
  fi
else
  systemctl --user enable --now omniwall-proxy.service
fi

if ! curl -fsS --retry 8 --retry-delay 1 http://127.0.0.1:3001/api/health >/dev/null || ! curl -fsS http://127.0.0.1:3001/ >/dev/null; then
  echo "Public health check failed; rolling proxy back." >&2
  if [[ -n "$previous_upstream" ]]; then
    printf '%s\n' "$previous_upstream" > "$UPSTREAM_FILE"
    systemctl --user reload omniwall-proxy.service
  else
    systemctl --user stop omniwall-proxy.service
    systemctl --user start omniwall-server.service
  fi
  exit 1
fi

printf '%s\n' "$candidate" > "$ACTIVE_FILE.tmp"
mv "$ACTIVE_FILE.tmp" "$ACTIVE_FILE"
# Do not reload the browser or terminate the old container: it may own work.
if [[ -n "$old_name" && "$old_name" != "$candidate_name" ]]; then
  old_command="$(docker inspect --format '{{json .Config.Cmd}}' "$old_name" 2>/dev/null || true)"
  if [[ "$old_command" == '["node","web.js"]' ]]; then
    # Web-only slots cannot own terminals or workers. Allow ordinary HTTP
    # responses to finish, then stop (not delete) the slot for rollback.
    sleep "${WEB_DRAIN_SECONDS:-15}"
    docker stop --time 30 "$old_name" >/dev/null
    echo "Stopped retired web-only slot $old_name; container/image retained for rollback."
  else
    echo "Retained legacy $old_name. Drain its sessions manually before reusing it."
  fi
fi

echo "Live: $candidate_name ($IMAGE) through http://127.0.0.1:3001"
