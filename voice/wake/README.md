# “Hé zumi” local wake word

Sherpa-ONNX Zipformer GigaSpeech **3.3M** keyword spotter, int8 models, one CPU thread. Runs on this Pi's ARM64 CPU and reads 16kHz mono PCM from the default PipeWire/PulseAudio input using `parec`. No microphone recordings, transcripts or raw audio are saved or sent by the detector. Model: Apache-2.0, https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models. Models and Python environment are downloaded locally, not committed.

This is an English acoustic model with configurable BPE keywords. We use phonetic variants `HEY ZUMI`, `HEY ZOOMIE`, `HAY ZOOMIE` for Hungarian “hé zumi”. It is **not** a Hungarian-trained custom wake model. Synthetic Hungarian positive and negative fixtures passed on this device; real household voices, accents, background music and false-trigger rates still need testing. Say “hé zumi”, pause for the voice panel, then give a command. Tune `configure.py` and regenerate keywords if needed.

## Setup

Run `bash voice/wake/install.sh`. In the user bridge service environment set:

```
GIZI_WAKE_ENABLED=1
# Optional: GIZI_WAKE_SOURCE=<PulseAudio input name>
# Optional: GIZI_WAKE_MODEL=<model directory>
# Optional: GIZI_WAKE_PYTHON=<venv python executable>
```

Restart `omni-gizi.service`, wait for `/gizi/status`, then restart the kiosk. The service needs the user's PipeWire runtime (`XDG_RUNTIME_DIR=/run/user/1000`). Microphone should be a USB microphone, not a Bluetooth headset profile. Switch the detector on/off in the voice panel; preference persists in private `wake-settings.json`. When off, both inference and microphone capture are stopped.

Wake events open the voice panel and begin the existing recording flow **only on the visible localhost Pi kiosk**, not on phones. Kiosk Chromium needs `--autoplay-policy=no-user-gesture-required` and prior microphone permission (the launcher supplies permission handling). Authenticated polling/claim endpoints permit only one client to consume a recent event. Eight-second cooldown and suppression during an active voice connection prevent repeated triggering. Because the voice connection remains open briefly for follow-ups, wake detection resumes after it closes.

After a wake, the existing voice session records up to 14 seconds and sends audio to Google as before. Wake-word detection is local, but the activated assistant is not. The microphone button/manual flow still works when the detector is disabled or unavailable. Phone microphone capture remains manual.

## Checks

```
voice/wake/.venv/bin/python voice/wake/detect.py --model ~/.config/omni-gizi/wake-model --pcm /path/to/16khz-mono-s16le.pcm
cd voice && npm test
GIZI_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/wake-browser-smoke.mjs
```

`/gizi/wake` exposes consent/readiness and event counters, not audio. Non-GET requests require a same-origin authenticated household session. Models can falsely trigger; disable wake listening when guests/children should not activate household actions.

## Bluetooth reconnect

The separate Spotify-modal button POSTs `/gizi/music/speaker/reconnect`. Server invokes fixed `bluetoothctl disconnect/connect/info` arguments without a shell and verifies `Connected: yes`. The MAC address is server configuration (`GIZI_SPEAKER_ADDRESS`), never browser-provided. Concurrent reconnects are rejected. It briefly interrupts audio but does not change Spotify's selected device or queue.
