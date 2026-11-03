# Upload applet and kiosk recovery — 2026-10-10

Deployed frontend image `omniwall:uploads-clock`; restarted Gizi and the kiosk, not raspotify or the persistent runtime.

## Frozen clock

The physical kiosk screenshot remained byte-identical at 19:05:19 on Friday Oct 9 across captures, despite the system clock being Saturday morning. A fresh Chromium session showed a ticking clock and no React errors. Restarting the old kiosk session restored ticking. The exact Chromium hang mechanism was not isolated; do not attribute this to the server clock or a proven React defect.

The Clock now emits a one-second heartbeat and refreshes on page visibility/pageshow. `kiosk-watchdog.mjs` runs independently of Chromium, probes its localhost-only DevTools port 9223, and checks both renderer responsiveness and heartbeat freshness. After a 120-second startup grace it probes every 30 seconds. Two consecutive failed probes terminate Chromium, allowing `omniwall-kiosk.service` (Restart=always) to relaunch it. This protects renderer/timer hangs, not all compositor/hardware failures. DevTools listens only on 127.0.0.1; it is not proxied remotely.

Regression tests simulate both stale heartbeats and unresponsive renderers. Live validation read the physical kiosk clock advancing from 10:06:56 to 10:06:58 through CDP, and captured an updated Saturday screen with the Upload applet.

## Files

Open Beezywall on another device using its Tailscale HTTPS address, choose Apps → Upload, select a folder, choose files and upload. Files are sent sequentially; the server streams bytes rather than buffering whole files. Maximum 200 MB per file; at most two uploads run concurrently; a 256 MB disk-space reserve is required.

Server-enforced roots: `~/Downloads`, `~/Documents/Uploads`, `~/Pictures`, `~/Music`, `~/Videos`. The picker can browse and create subfolders under these roots. Arbitrary system/home/code paths are not accepted. Hidden components, traversal, symlink directories/files and application/source folders identified by common project markers are blocked. Directory file descriptors pin destinations; final writes use exclusive creation and no symlink following. Files have mode 0600; nothing is executed and existing files are never overwritten. Interrupted uploads are removed.

The dedicated Documents/Uploads root remains usable even if Documents itself contains an unrelated go.mod; source markers inside the allowed root or descendants still block those directories. This case was found by the live smoke test and has a regression test.

Endpoints `/gizi/files/*` require browser pairing/access-key authorization and same-origin writes, following the existing household service trust model. This is not an anonymous internet upload service. Gizi restarts rotate browser pairing and reset session-only radio mode; applets re-pair as needed.

Tests: `node --test voice/test/file-upload.test.js voice/test/kiosk-watchdog.test.js voice/test/music.test.js client/src/lib/giziMusic.test.js`.

Live smoke: phone-sized Chromium uploaded a small text file through the actual UI into Documents/Uploads, verified its bytes, and confirmed `/etc` is rejected. The smoke file was removed afterward.
