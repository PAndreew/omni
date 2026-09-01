#!/usr/bin/env bash
# Disable/enable all libinput touchscreen devices. Run over SSH.
set -euo pipefail

RULE=/etc/udev/rules.d/99-omniwall-disable-touchscreen.rules

case "${1:-status}" in
  lock)
    sudo tee "$RULE" >/dev/null <<'EOF'
# OmniWall child-safe mode: display remains active, touch events are ignored.
SUBSYSTEM=="input", KERNEL=="event*", ENV{ID_INPUT_TOUCHSCREEN}=="1", ENV{LIBINPUT_IGNORE_DEVICE}="1"
EOF
    sudo udevadm control --reload-rules
    echo "Touchscreen locked. Restarting the graphical session to apply it."
    sudo systemctl restart lightdm.service
    ;;
  unlock)
    sudo rm -f "$RULE"
    sudo udevadm control --reload-rules
    echo "Touchscreen unlocked. Restarting the graphical session to apply it."
    sudo systemctl restart lightdm.service
    ;;
  status)
    if [[ -f "$RULE" ]]; then
      echo locked
    else
      echo unlocked
    fi
    ;;
  *)
    echo "Usage: $0 {lock|unlock|status}" >&2
    exit 2
    ;;
esac
