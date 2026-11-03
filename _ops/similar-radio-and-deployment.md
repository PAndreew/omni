# Similar radio and persistent runtime

## Deployed

On 2026-10-09 the legacy all-in-one Docker slot was migrated to a persistent host runtime on localhost:3103. `omniwall-runtime.service` owns APIs, Socket.IO, terminals, scheduler, calendar sync, audio metadata and CEC. Caddy routes `/api/*`, `/socket.io/*` and `/remote` to it; `/gizi/*` stays on the independent Gizi service, port 3002. All other web traffic uses the blue/green frontend slot.

The frontend Docker image runs `server/web.js` only: no SQLite, native PTYs or background workers. Ordinary `bash deploy-blue-green.sh` deploys never restart the runtime, Gizi, kiosk or raspotify. Deployment requires the runtime to be healthy, validates Caddy, locks out concurrent deploys and checks the candidate before routing traffic. An old web-only slot is stopped after a 15-second HTTP drain (override `WEB_DRAIN_SECONDS`), but its container/image remain available for rollback. A running inactive slot is not forcibly deleted. Legacy slots require explicit draining.

`install-runtime.sh` is a separate maintenance operation. It snapshots server source under `~/.omniwall/bluegreen/runtime/releases`, uses the existing server dependencies, and installs the systemd unit. Runtime upgrades require explicitly stopping the runtime first; this closes its terminals. Shared node_modules still require maintenance coordination for dependency upgrades. The database lives at `server/data/omniwall.db`; an online backup was saved as `server/data/omniwall.before-runtime.db` before migration. No database migrations should run in frontend images.

Validated against a real deployment: runtime PID unchanged, Socket.IO WebSocket stayed connected, and a PTY environment variable survived a second blue/green cutover. Spotify remained playing on OmniWall. Initial migration required stopping the legacy backend. Neither raspotify nor the kiosk was restarted; Gizi was restarted once to load radio code.

Frontend rollback: confirm the retained slot is web-only, start it with `docker start omniwall-<slot>`, health-check its local port (blue 3101, green 3102), restore the upstream fragment to that port, reload `omniwall-proxy.service`, then update `active-slot`. Do not start a legacy all-in-one image alongside the runtime: it duplicates background jobs. Legacy proxy backup is `~/.omniwall/bluegreen/Caddyfile.before-runtime` and its upstream backup is `upstream.before-runtime.caddy`.

For commands outside a logged-in user session set `XDG_RUNTIME_DIR=/run/user/1000` for user systemd access. Deployment scripts set this automatically.

## Similar songs experiment

Enabled after deployment. Polls every 15 seconds even when the music browser is closed. Only playing, unrestricted OmniWall playback with repeat off and an empty Spotify queue is eligible. Existing queues win. It never issues play/resume/transfer. Non-explicit, unseen tracks come from recommendations, falling back to same-artist search on recommendation 403/404 only. A live read-only probe returned Recommendations 404, so this account uses the fallback; it is not genre matching.

Toggle in the Spotify browser. Disabling does not remove queued suggestions. Restarting Gizi disables the session-only experiment. Queue reads/writes are not atomic: a manual addition can race the final check. Unknown writes are not retried for that track. Diversity is limited to ten search results, so it stops rather than repeating indefinitely.

Tests: `node --test voice/test/similar-radio.test.js voice/test/music.test.js`; frontend: `npm run build --workspace client`. Full voice sessions and automatic rollback failures were not exercised during this migration.
