#!/usr/bin/env bash
# OmniWall kiosk launcher

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# The Raspberry Pi DSI touchscreen is 800x480 at X coordinate 1920.
# Keep the desktop and HDMI output running, but place OmniWall on DSI-2.

# Wait for OmniWall server (up to 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:3001/api/weather > /dev/null && break
  sleep 1
done

# Use a tmpfs-backed profile so cache never accumulates across restarts.
# /tmp is cleared on every reboot; Chromium rebuilds it instantly.
KIOSK_PROFILE=/tmp/chromium-kiosk
mkdir -p "$KIOSK_PROFILE"

# Make DSI-2 Wayfire's active output before Chromium creates its window.
# Wayfire otherwise places new windows on the HDMI display regardless of
# Chromium's requested X coordinate.
xdotool mousemove 2320 240 click 1 2>/dev/null || true
sleep 0.5

# Launch Chromium full-screen on the DSI touchscreen.
chromium-browser \
  --ozone-platform=x11 \
  --window-position=1920,0 \
  --window-size=800,480 \
  --enable-low-end-device-mode \
  --renderer-process-limit=3 \
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

# Wayfire/XWayland can ignore Chromium's initial geometry. Place the app on
# DSI-2 first, then enter browser fullscreen on that output.
for i in $(seq 1 20); do
  WIN=$(xdotool search --name '^OmniWall$' 2>/dev/null | tail -1)
  if [ -n "$WIN" ]; then
    xdotool windowmove "$WIN" 1920 0 2>/dev/null || true
    xdotool windowsize "$WIN" 800 480 2>/dev/null || true
    xdotool windowactivate "$WIN" key F11 2>/dev/null || true
    break
  fi
  sleep 0.5
done

wait $CHROME_PID
