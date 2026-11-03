# Spotify browser

The dashboard Spotify modal uses `/gizi/music`, not the old core Spotify APIs. It therefore works on the Tailscale HTTPS endpoint without exposing additional core endpoints. Browser sessions use existing Gizi pairing; CLI clients can use the Gizi bearer key. Writes require a matching Origin. Access remains shared household access, not per-user tenancy.

Endpoints: GET `state`, `search?q=...`, `library`, `recent`; POST `play` with `{uri: "spotify:track:..."}` or a playlist URI; POST `command` with `resume`, `pause`, `previous`, or `next`.

Playback defaults to the one unrestricted device named OmniWall. The browser may explicitly select another online device using Connect; subsequent browser controls target that exact device ID. Voice-agent playback remains restricted to OmniWall. An offline/ambiguous device fails instead of falling back to another device. A successful response means Spotify accepted the request, not that audible playback was verified. Unknown outcomes must not be retried automatically.

Recent tracks/playlists are stored privately in the controller's `receipts/music-history.json`, capped at 80 unique items. Explicit playback from Gizi or the modal is remembered; while the modal is open, observed Spotify tracks/playlist contexts are also remembered. Existing pre-install playlist history cannot be reconstructed. Spotify account-wide recent tracks additionally require `user-read-recently-played`; the currently configured token lacks that scope, so the modal explains its local-history fallback. A scope change requires the owner's Spotify authorization flow, not merely refreshing the token. Saved playlists are shown separately from recent playlists.

GET `devices` merges Spotify's currently available devices with previously seen devices in `receipts/music-devices.json` (maximum 30). Spotify does not list all offline devices, so unseen offline devices cannot be shown. POST `connect` with `{deviceId}` rechecks availability then transfers playback with `play: true`; it does not merely pair an account. The browser records the selected device only on an accepted transfer.

Speaker volume uses GET/POST `speaker/volume` with `{percent}` on writes. It controls the configured Pi Bluetooth sink through fixed `pactl` arguments, not the phone's volume or Spotify's device-volume API. Offline sinks fail clearly; input must be an integer from 0–100, so software amplification above 100% is rejected. The UI slider commits on release/keyboard completion, with ±5% buttons and current level readback.

## Restart Spotify control (one-time privileged setup)

The separate **Restart Spotify** button POSTs `restart`, with same-origin/session authorization and a user confirmation prompt. The server runs only `systemctl --no-ask-password restart raspotify.service` and checks that the service becomes active. It accepts no service name or command from the browser. Concurrent restarts and repeated attempts within a minute are blocked; a confirmed authorization denial can be retried after setup. It does not claim that the Spotify cloud device is already visible or automatically resume playback.

Run once from a normal Pi terminal/SSH session (not this restricted Pi Web subprocess):

```sh
sudo bash /home/pi/Documents/omni/voice/install-spotify-controls.sh
```

This installs a root-owned Polkit rule granting the invoking application user only the `restart` verb for `raspotify.service`. It grants no general sudo, shell execution, other service actions, or systemd unit-file changes. `NoNewPrivileges` stays enabled. Remove `/etc/polkit-1/rules.d/49-beezywall-spotify.rules` as root to revoke this permission. The HTTP route reports a clear setup error until permission is installed. All authenticated household users with access to this UI can interrupt Spotify using this button; voice tools do not expose service restart.

There is no configured Beezywall overnight TTL or systemd runtime limit. The observed incident had a still-running `librespot` process after a “Websocket peer does not respond” warning, with OmniWall absent from Spotify's available devices. This points to stale connectivity, not proven token expiry or a process crash. Spotify API access tokens expire normally and are refreshed by the controller. A health watchdog would need to distinguish cloud/network failure and normal idle-device visibility from a stuck client; a blind nightly restart is not added here.

State refresh runs every 15 seconds while the modal is visible. Search is debounced and stale requests are canceled. Neither tests nor automatic refresh play music.

Tests: `cd voice && npm test`; optional real browser checks after a client build: `GIZI_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/dashboard-smoke.mjs`.
