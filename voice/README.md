# Gizi: recorded Hungarian voice → Pi → Spotify

## Using it

Open **https://raspberrypi.tailf0acdd.ts.net:9443/** on a phone connected to the same Tailscale network. Phone microphone access requires HTTPS; the ordinary LAN HTTP address does not qualify.

1. Open the **Gizi** microphone button and enter the household access key (`~/.config/omni-gizi/access-key`). An existing private `#gizi-key=...` pairing link still works; its fragment is removed after loading and never sent to the HTTP server.
2. Tap **Talk to Gizi**, allow microphone access, and wait for **Listening**.
3. Speak, then tap **Send**. Recording and the physical microphone stop. The complete recording is uploaded for transcription. The 14-second recording cutoff also automatically submits it.
4. See the transcript and wait for Pi. Successful playback gets a short local happy chirp; uncertainty or questions get a brief Hungarian spoken reply on the phone. Music plays on **OmniWall → JBL**.
5. Tap **Reply** for another turn, or **Stop** to disconnect.

Examples:

- “Indítsd el Farruko Pepas című számát!” — searches for the song, resolves its ID, starts it on OmniWall, then plays a short happy chirp.
- “Indítsd el az órást!” — resolves the family nickname **órás** to Lost Frequencies & Calum Scott — **Where Are You Now**, starts it, then chirps.
- “Hány dal van a csajok lejátszási listán?” — reads the list and reports its current count.
- “Tedd hozzá a csajokhoz a Pepast!” — adds it if absent, then verifies the addition.
- “Állítsd meg a zenét!” — pauses OmniWall.

The physical wall shows the same button, but needs an attached microphone. Touch remains disabled if previously disabled. No Whisper or continuous cloud listening is used. Optional local Sherpa-ONNX wake-word detection for “hé zumi” is now available; see [wake setup and privacy](wake/README.md). The page must remain open; Stop, close-panel, hide-page and connection-loss clean up capture. This is deliberately turn-based, not full-duplex barge-in.

## Current pipeline and model choice

```text
Browser AudioWorklet → bounded 16 kHz PCM recording in Pi RAM
  → Send / 14-second cutoff
  → complete WAV → Gemini 3.5 Flash → structured verbatim transcript
  → restricted Pi SDK session → typed Spotify tools
  → success: local happy chirp; otherwise: Hungarian Google Cloud TTS → browser speakers
```

**Transcription:** `gemini-3.5-flash`, project `currentlyai`, region `eu`. This is a general audio-understanding model used strictly for speech-to-text: audio plus transcription-only instructions, temperature zero, a JSON `{ transcript }` schema, and no tools. It sees the complete utterance instead of Live interpreting streaming speech and generating inferred function-call arguments. Hungarian is the primary language; song/artist names retain their original language.

Google now documents a dedicated `gemini-3.5-transcribe` model with Hungarian listed as Experimental, but GA and preview calls in currentlyai returned HTTP 404/not-found-or-no-access. We did **not** deploy that unavailable endpoint. Gemini 2.5 Flash was also considered, but its documented October 20, 2026 retirement made the available GA 3.5 Flash a better default. There is no automatic fallback to another model/provider after failure.

**Speech output:** Google Cloud Text-to-Speech, `hu-HU-Chirp3-HD-Aoede`, 24 kHz LINEAR16; WAV headers are parsed and removed before PCM playback. Voice availability and synthesis were checked in currentlyai. Pi replies are brief Hungarian text, preserving foreign artist/song names. Successful playback actions use a generated 340 ms two-note local chirp—no long confirmation and no TTS cost. Failures, uncertainty, clarification questions, read-only answers and playlist-edit results remain spoken. TTS only runs after Pi returns such a result. If TTS fails, the verified written answer remains visible and the action is not repeated. Spoken text is bounded to 500 characters; full returned text remains in the panel.

**Pi reasoning:** the owner's configured Pi model/provider, currently `openai-codex / gpt-6-astra`. This uses existing Pi authentication and is separate from Vertex billing. It receives exactly the transcript as quoted untrusted user text, never a speech model's rephrased command.

**Spotify:** `~/.config/omni-spotify/token.json`, authorized as Andras Pasztor. Raspotify must use the same account. Individual tracks can now be started directly; there is no need to add them to csajok first.

## Code and restrictions

- `client/src/components/GiziButton.jsx`: panel, pairing, status.
- `client/src/hooks/useGiziVoice.js`: microphone permissions, websocket, playback, cleanup.
- `client/public/gizi/`: lightweight streaming resampling, not speech recognition.
- `voice/server.js`: localhost-only authenticated voice socket, origin checks, single-session gate, rate/frame bounds, session allowance, narrow read-only dashboard proxy.
- `voice/google.js`: explicit-project Google client and short-lived token acquisition from the owner's existing gcloud login. No global project change; no Google credentials in browser/model context.
- `voice/speech.js`: bounded RAM recording, WAV conversion, transcription, exact-transcript delegation, local success chirp, cancellation and Hungarian TTS.
- `voice/metadata.json` + `metadata.js`: validated trusted family aliases/notes for tracks and playlists. Seeded with `órás` and `csajok`; aliases are exact after Unicode/case/punctuation normalization.
- `voice/agent.js`: fresh Pi session with explicit resources. No personal extensions, skills, context files, MCP, shell, read or write tools.
- `voice/spotify.js`: token refresh, exact device selection, typed operations and mutation receipts.

The seven Pi tools are trusted family metadata resolution, Spotify search, read csajok, add to csajok, playback, read-only MusicBrainz catalogue search, and candidate confirmation. Spotify search tries bounded cleaned/original variants for repeated words. Ambiguous/approximate candidates ask for confirmation; web-derived candidates must be resolved back to Spotify and explicitly confirmed before playback or addition. The code—not just the model prompt—blocks uncertain mutations. Pending confirmation and short candidate context are usable in household memory for at most two minutes, including across a fresh wake/voice connection. An exact spoken “igen”/“yes” consumes the selected candidate before acting, with no automatic retry if the outcome is unknown. MusicBrainz receives only the title/artist query, never microphone audio or Spotify credentials; there is no arbitrary URL browsing. See [music-resolution details](MUSIC-RESOLUTION.md). Playback supports `play_track` with a valid resolved track ID, `play_csajok`, resume, pause, next, previous and status. Only the exact **OmniWall** device is eligible; never fall back to a phone or another speaker. Playlist writes remain restricted to csajok and skip existing tracks. Playlist creation/deletion, arbitrary playlist search/play through voice, smart-home control, coding, and installation are not enabled.

The dedicated phone route exposes read-only weather/calendar/chores, not the old settings API, arbitrary writes or terminal Socket.io channel. No Tailscale Funnel/public-internet exposure was enabled. The legacy Omni service remains unchanged and is not claimed to be secured by this work.

No raw audio or transcripts are saved by this bridge. Recordings live in bounded RAM and are discarded after submission or cancellation. Pi history is in memory. Persistent bridge state is the voice key, daily usage reservation and Spotify operation receipts (never authorization tokens). Standard provider credential storage and provider retention policies are separate.

Stop aborts transcription/Pi/TTS where possible. Already-sent Spotify mutations may have committed. Receipts prevent blindly repeating the same operation ID; this is not universal exactly-once behavior across newly worded requests. Never retry an unknown mutation outcome automatically.

## Limits and maintenance

Default conversation maximum: **120 seconds**. Recording maximum: 14 seconds in the client, 15 on the server. One active conversation. Up to six Pi turns/conversation, eight tool calls/request, a 30-second agent deadline, and 2,048 output tokens per model response. No agent retry loop or idle prompt-cache warming.

Default daily allowance: **900 session-seconds per UTC day**, reserved in full session blocks at startup. At 120 seconds this allows seven starts on a fresh day; early disconnects and failed starts conservatively keep their reservation. Counters survive restarts. This is not a guaranteed currency cap: billing budgets/spend caps were not changed, and Pi provider usage is separate. Transcription and TTS now incur per-request charges rather than continuous Live audio charges.

```bash
bash voice/install-service.sh
systemctl --user status omni-gizi.service
journalctl --user -u omni-gizi.service -f
systemctl --user restart omni-gizi.service
```

In a non-desktop shell set `XDG_RUNTIME_DIR=/run/user/1000` and `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` if needed.

Configuration: `~/.config/omni-gizi/runtime.env`:

```text
GIZI_GCP_PROJECT=currentlyai
GIZI_GCP_LOCATION=eu
GIZI_TRANSCRIBE_MODEL=gemini-3.5-flash
GIZI_TTS_VOICE=hu-HU-Chirp3-HD-Aoede
GIZI_SESSION_SECONDS=120
GIZI_DAILY_SECONDS=900
# Optional: GIZI_PI_PROVIDER and GIZI_PI_MODEL (set together)
# Optional: GIZI_SPOTIFY_TOKEN=/path/to/token.json
# Optional: GIZI_METADATA=/path/to/metadata.json
```

`GIZI_LIVE_MODEL` is no longer used. `GET /gizi/status` reports the active transcription model and mode without consuming a transcription request.

The host Caddy proxy serves the new UI and `/gizi` from port 3002; old APIs remain on the existing blue-green container. `deploy-blue-green.sh` preserves routing when the Gizi service is installed. Re-run the voice installer to build/deploy changed UI and voice code; a container rebuild alone does not rebuild the host-served UI.

Rotate the access key by replacing `~/.config/omni-gizi/access-key` with a new random string (0600), then restarting. Existing pairings must use the new key. A pairing authorizes the limited music capabilities, not owner identity or coding access.

Rollback: disable `omni-gizi.service`, restore `~/.omniwall/bluegreen/Caddyfile.before-gizi` to `Caddyfile`, reload `omniwall-proxy.service`, and run `tailscale serve --https=9443 off`.

## Tests and remaining validation

```bash
cd voice
npm test
GIZI_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/browser-smoke.mjs
# Optional billable Google/Pi test; does not change actual playback:
node test/cloud-smoke.mjs
```

Tests cover authentication, origin rejection, metadata normalization/validation/atomic writes, alias resolution, local success chirps, playback tool targeting/validation, token refresh, receipt replay protection, PCM and WAV conversions, buffer-transfer detachment, whole-recording transcription configuration, silence rejection, exact-once transcript dispatch, Stop during transcription, no speculative speech before an agent result, TTS failure without action replay, daily accounting, and browser cleanup/follow-up.

The real-cloud smoke test synthesizes two clear Hungarian fixtures, transcribes them using 3.5 Flash, sends them through the real Pi agent, and synthesizes the replies using Hungarian TTS. It checks the current playlist count and a resolved Farruko/Pepas `play_track` call. Playback writes are intercepted; songs and playlist contents are not changed by this test. Both Hungarian phrases passed, including “Hány dal,” which the former Live path often garbled into “Hajnal.” This is a synthetic smoke test, not a benchmark of children's voices or noisy-room recognition.

The next validation is real phone speech, children's voices, music noise and ambiguous songs. Music is not automatically ducked. Keep the phone away from loud JBL output initially. Recognition can still be wrong; watch the displayed transcript, and Pi should clarify ambiguous song matches.

The service still runs as the existing `pi` Unix user with owner credentials. Explicit tool restriction and `NoNewPrivileges` are not an OS sandbox. Use a separate restricted identity/credential broker before adding higher-risk home devices or coding access.

## Documentation references

- [Audio understanding and transcription](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/audio-understanding)
- [Gemini 3.5 Flash](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash)
- [Gemini 3.5 Transcribe, including Experimental Hungarian and endpoint availability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-transcribe)
