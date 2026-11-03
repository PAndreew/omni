#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
MODEL=${GIZI_WAKE_MODEL:-${GIZI_STATE_DIR:-$HOME/.config/omni-gizi}/wake-model}
command -v parec >/dev/null || { echo 'Install pulseaudio-utils (parec) first.' >&2; exit 1; }
python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -r "$ROOT/requirements.txt"
ARCHIVE=$(mktemp)
trap 'rm -f "$ARCHIVE"' EXIT
curl -fL 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2' -o "$ARCHIVE"
echo "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a  $ARCHIVE" | sha256sum -c -
mkdir -p "$MODEL"
tar -xjf "$ARCHIVE" -C "$MODEL" --strip-components=1
"$ROOT/.venv/bin/python" "$ROOT/configure.py" "$MODEL"
echo 'Installed. Set GIZI_WAKE_ENABLED=1 or enable the wake switch in the voice panel, then restart omni-gizi.service.'
