#!/usr/bin/env bash
# OmniWall kiosk launcher

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# Place Chromium on the active DSI-2 output, using its live logical geometry.

# Weather belongs to the independent core and can be ready while the UI
# bridge is restarting. Wait for the actual page and bridge before Chromium.
READY=false
for i in $(seq 1 60); do
  if curl --max-time 2 -fsS http://localhost:3001/ > /dev/null &&
     curl --max-time 2 -fsS http://localhost:3001/gizi/status > /dev/null; then
    READY=true
    break
  fi
  sleep 1
done
if [ "$READY" != true ]; then
  echo "Beezywall UI did not become ready; refusing to launch an error page." >&2
  exit 1
fi

# Use a tmpfs-backed profile so cache never accumulates across restarts.
# /tmp is cleared on every reboot; Chromium rebuilds it instantly.
KIOSK_PROFILE=/tmp/chromium-kiosk
mkdir -p "$KIOSK_PROFILE"

# XWayland exposes the output's logical position and size even if Wayfire's
# output configuration changes. Fall back to the Pi's usual DSI geometry.
GEOMETRY=$(xrandr --query 2>/dev/null | grep -m1 -E ' connected [0-9]+x[0-9]+\\+[0-9]+\\+[0-9]+' || true)
if [[ $GEOMETRY =~ ([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+) ]]; then
  WIDTH=${BASH_REMATCH[1]}; HEIGHT=${BASH_REMATCH[2]}
  X=${BASH_REMATCH[3]}; Y=${BASH_REMATCH[4]}
else
  WIDTH=800; HEIGHT=480; X=1920; Y=0
fi

# Wayfire puts new windows on the active output, regardless of requested X.
xdotool mousemove "$((X + WIDTH / 2))" "$((Y + HEIGHT / 2))" 2>/dev/null || true
sleep 0.5

# Kiosk mode requests true compositor fullscreen without app-window chrome.
chromium-browser \
  --kiosk \
  --ozone-platform=x11 \
  --window-position="$X,$Y" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-low-end-device-mode \
  --renderer-process-limit=3 \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9223 \
  --background-color=000000 \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-component-update \
  --no-first-run \
  --user-data-dir="$KIOSK_PROFILE" \
  --disk-cache-size=0 \
  --disable-gpu-shader-disk-cache \
  --disable-extensions \
  --disable-sync \
  --disable-background-networking \
  --disable-translate \
  --disable-notifications \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --app=http://localhost:3001 &

CHROME_PID=$!
node "$(dirname "${BASH_SOURCE[0]}")/kiosk-watchdog.mjs" "$CHROME_PID" &
WATCHDOG_PID=$!
trap 'kill "$WATCHDOG_PID" 2>/dev/null || true' EXIT

# Fullscreen requests can race Wayfire's initial placement. Verify the
# resulting geometry; retry compositor fullscreen only if it did not stick.
for i in $(seq 1 20); do
  WIN=$(xdotool search --name '^(Beezywall|OmniWall)$' 2>/dev/null | tail -1)
  if [ -n "$WIN" ]; then
    for attempt in 1 2 3; do
      CURRENT=$(xdotool getwindowgeometry --shell "$WIN" 2>/dev/null)
      if [[ $CURRENT =~ (^|$'\n')X=$X($'\n'|$) && $CURRENT =~ (^|$'\n')Y=$Y($'\n'|$) && $CURRENT =~ (^|$'\n')WIDTH=$WIDTH($'\n'|$) && $CURRENT =~ (^|$'\n')HEIGHT=$HEIGHT($'\n'|$) ]]; then
        break
      fi
      xdotool windowactivate --sync "$WIN" 2>/dev/null || true
      xdotool key F11 2>/dev/null || true
      sleep 1
    done
    break
  fi
  sleep 0.5
done

wait $CHROME_PID
