#!/usr/bin/env bash
# OmniWall kiosk launcher

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# Wait for OmniWall server (up to 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:3001/api/weather > /dev/null && break
  sleep 1
done

# Launch Chromium in X11 mode (reliable kiosk fullscreen via Xwayland)
chromium-browser \
  --ozone-platform=x11 \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-component-update \
  --no-first-run \
  --disk-cache-size=0 \
  --disable-application-cache \
  --app=http://localhost:3001 &

CHROME_PID=$!

# Wait for Chromium + Xwayland to fully initialise before touching outputs.
# Wayfire re-evaluates outputs when Xwayland starts, which can re-enable DSI-2.
sleep 8
wlr-randr --output DSI-2 --off 2>/dev/null || true

wait $CHROME_PID
