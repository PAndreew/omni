# Raspberry Pi 5 Display Configuration (OmniWall)

To prevent the secondary DSI-2 screen from enabling itself and to ensure the HDMI TV (HDMI-A-2) maintains a consistent 1080p resolution (even when powered off/on), the following manual configurations were applied.

## 1. Kernel Command Line (`/boot/firmware/cmdline.txt`)
Added video parameters to the end of the single line in this file:
- `video=DSI-2:d` : Hard-disables the DSI-2 output at the kernel level.
- `video=HDMI-A-2:1920x1080@60D` : Forces HDMI-A-2 to stay active at 1080p 60Hz. The `D` suffix forces the digital output to "connected" even if the TV is off.

**Current state:**
```text
console=serial0,115200 console=tty1 root=PARTUUID=0bd53fb5-02 rootfstype=ext4 fsck.repair=yes rootwait quiet splash plymouth.ignore-serial-consoles cfg80211.ieee80211_regdom=HU video=DSI-2:d video=HDMI-A-2:1920x1080@60D
```

## 2. Firmware Config (`/boot/firmware/config.txt`)
Disabled automatic display detection to prevent the firmware from waking up the DSI screen.

**Change:**
```ini
display_auto_detect=0
```

## 3. Wayfire Configuration (`~/.config/wayfire.ini`)
The compositor is configured to keep DSI-2 disabled and HDMI-A-2 at the correct resolution.

```ini
[output:DSI-2]
enabled = false

[output:HDMI-A-2]
mode = 1920x1080@60
position = 0,0
transform = normal
scale = 1.000000
```

## 4. Kiosk Launcher (`~/Documents/omni/launch-kiosk.sh`)
Added proactive `wlr-randr` calls to ensure the display state is correct before and after Chromium launches.

```bash
# Force DSI-2 off before starting Chromium
wlr-randr --output DSI-2 --off 2>/dev/null || true

# ... chromium launch ...

# Re-check and force DSI-2 off again after 10s (Xwayland startup can trigger re-enablement)
(
  sleep 10
  wlr-randr --output DSI-2 --off 2>/dev/null || true
) &
```

## Troubleshooting
If the display still behaves incorrectly after a TV power cycle:
1. Verify `wlr-randr` output.
2. Check if `display_auto_detect=0` is still set in `/boot/firmware/config.txt`.
3. Ensure a full reboot was performed after editing `cmdline.txt`.
