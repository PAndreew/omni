#!/usr/bin/env bash
# OmniWall kiosk launcher

export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
export WAYLAND_DISPLAY=wayland-1
export XDG_RUNTIME_DIR=/run/user/1000

# Kill the panel and its respawner so it doesn't eat 68px of screen.
pkill -f 'wfrespawn wf-panel-pi' 2>/dev/null || true
pkill -f 'wf-panel-pi'           2>/dev/null || true
sleep 1

# Wait for OmniWall server (up to 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:3001/api/weather > /dev/null && break
  sleep 1
done

# Launch Chromium kiosk in background so we can fix the window position
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

# Wait for the OmniWall window to appear, then force it to 0,0 full-screen.
for i in $(seq 1 30); do
  WIN=$(DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority \
        xdotool search --name "OmniWall" 2>/dev/null | head -1)
  [ -n "$WIN" ] && break
  sleep 1
done

if [ -n "$WIN" ]; then
  DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority xdotool \
    windowfocus "$WIN" \
    windowsize  "$WIN" 1920 1080 \
    windowmove  "$WIN" 0 0
fi

wait $CHROME_PID
