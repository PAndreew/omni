# Omni document translator

Ported from `/home/pi/home-applets/src/applets/document-translator` and its PDF processor. DOCX XML parts, formatting/run markers, retries, parallel batches, and positioned PDF rendering are preserved. The worker loads no user/project instructions, extensions, skills, or tools.

## Install and deploy on this Pi

```sh
cd /home/pi/Documents/omni/voice
npm ci
python3 -m venv translator/.venv
translator/.venv/bin/pip install -r translator/requirements.txt
cd ../client
npm ci
npm run build
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
systemctl --user restart omni-gizi.service
systemctl --user reload omniwall-proxy.service
systemctl --user restart omniwall-kiosk.service
```

The bridge serves `client/dist` directly; translator-only updates do not require rebuilding the core Docker container. Caddy must route `/gizi/*`, `/assets/*`, `/`, and `/beezee-logo.svg` to port 3002. Existing blue-green deployment keeps these routes.

Pi model credentials and defaults are read from the host user's Pi configuration. Model requests incur the provider's normal costs. Python can be overridden with `OMNI_TRANSLATOR_PYTHON`.

## API and persistence

`POST /gizi/translations`: raw document bytes, `Content-Type: application/octet-stream`, `X-Filename`, `X-Target-Language`, optional `X-Source-Language`. Requires same Origin and the existing Gizi browser session or Bearer access key.

`GET /gizi/translations/:id`: status/progress/error.

`GET /gizi/translations/:id/download`: successful translated document.

Maximum upload 20 MB; maximum two concurrent jobs. PDF limits: 100 pages and 2,000 text blocks. Scanned PDFs are unsupported. Jobs and documents are private household data stored under `$GIZI_STATE_DIR/translations` (default `~/.config/omni-gizi/translations`); they are retained until manually removed. This follows Gizi's shared household authorization model, not the old app's per-user ownership. Old jobs are not imported. Workers are children of the bridge; restarting the bridge interrupts active translations.

Pi skill: `.agents/skills/omni-document-translator`; installed on this device via a user-skill symlink. Run `/reload` in existing Pi sessions to discover it.
