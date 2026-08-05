#!/usr/bin/env bash
# OmniWall kiosk launcher

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# Keep DSI-2 and the Raspberry Pi desktop/panel running. HDMI-A-1 is the
# compositor's logical origin, so Chromium's kiosk opens on the TV.

# Wait for OmniWall server (up to 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:3001/api/weather > /dev/null && break
  sleep 1
done

# Use a tmpfs-backed profile so cache never accumulates across restarts.
# /tmp is cleared on every reboot; Chromium rebuilds it instantly.
KIOSK_PROFILE=/tmp/chromium-kiosk
mkdir -p "$KIOSK_PROFILE"

# Launch Chromium in kiosk mode on the logical-origin TV output.
chromium-browser \
  --ozone-platform=x11 \
  --kiosk \
  --window-position=0,0 \
  --window-size=1920,1080 \
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
  --app=http://localhost:3001 &

CHROME_PID=$!

wait $CHROME_PID
