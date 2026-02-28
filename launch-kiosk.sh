#!/usr/bin/env bash
# OmniWall kiosk launcher

export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# Make sure touchscreen display is off (saves power, already disabled in wayfire.ini)
wlr-randr --output DSI-2 --off 2>/dev/null || true

# Wait for OmniWall server (up to 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:3001/api/weather > /dev/null && break
  sleep 1
done

exec chromium-browser \
  --ozone-platform=wayland \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-component-update \
  --no-first-run \
  --disk-cache-size=0 \
  --disable-application-cache \
  --app=http://localhost:3001
