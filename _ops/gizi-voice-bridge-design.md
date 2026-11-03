# Hé Gizi: voice bridge to Pi

Status: design proposal; no voice services, credentials, cloud settings, or application code changed.

## 1. Goal and recommendation

A daughter says “Hé Gizi, add Pepas to csajok and play it.” A local wake detector activates a short cloud voice session. Gemini Live handles conversational audio; Pi interprets the household request and uses approved tools; the voice layer reports the verified result.

Recommended: **local wake/audio service → Gemini Live → dedicated Pi household worker → capability service → Spotify / future home adapters**.

Gemini is the conversational front end, not a second app-control agent. Pi owns planning, clarification, and tool use. Deterministic application code owns authorization, resource limits, and side effects.

This uses the Pi coding-agent engine, but NOT this privileged development conversation. The household worker gets its own context, credentials, and restricted tools. The owner can use the same Spotify extension from a normal Pi session. Attaching voice directly to this existing chat is a different, higher-risk requirement and is not assumed.

## 2. What is already present

- Raspotify is installed, advertises `OmniWall`, and plays via PipeWire to the JBL. Keep it as the Spotify Connect renderer.
- Direct Spotify Web API access through the user's Omni OAuth application worked. The private `csajok` playlist was created and its four items verified. Playlist ID: `24zkMDCr0Km6Qc47GYZvhn`.
- That was a one-off integration, not yet a reusable controller: refresh management, cancellation, policy, tests, and durable operation tracking still need building. Do not depend on the broken spotify-player authentication path.
- New PKCE credentials are in `~/.config/omni-spotify/token.json`. The existing `server/services/spotify.js` separately uses database credentials and a client-secret flow. Consolidate deliberately; do not silently overwrite either store.
- `_ops/voice assistant.md` describes an older design. `server/index.js` currently returns HTTP 410 for voice endpoints and does not start the old voice pipeline.
- `server/services/voice/` contains an older Deepgram/Pi/Chirp pipeline. `server/services/agent.js` imports the legacy `@mariozechner` package, manually executes tool calls observed in `message_end`, and recreates sessions afterward. Do not carry that workaround into a current SDK integration: let Pi execute registered tools and persist actual results.
- Existing Spotify code falls back to the first available device. The new household integration must not do this; only the configured OmniWall device is eligible.
- `arecord -l` shows no capture hardware; PipeWire exposes only the JBL output monitor. A monitor is playback loopback, not a microphone. The PartyBox's karaoke mic cannot be assumed to arrive over Bluetooth.
- `gcloud` currently defaults to project `beezy-kms`, not the stated `currentlyai`. Every new client must explicitly select the intended project; do not change the user's global gcloud configuration.
- There are unrelated uncommitted Omni UI changes. Keep implementation isolated from them.

## 3. Documentation findings and gates

### Pi

The installed docs describe `@earendil-works/pi-coding-agent`:

- SDK: `createAgentSession`, explicit tools/resources, subscriptions, `prompt`, `abort`, and session managers.
- `agent_settled`, not `agent_end`, is the final automatic-work boundary. Subscribe before prompting. `message_end` is authoritative for completed messages; text deltas are not verified outcomes.
- Concurrent prompts need explicit steering/follow-up semantics. Prefer a bridge-owned queue with one active household run.
- Extensions register executable typed tools. Skills provide instructions and can include supporting scripts; a skill is not an authorization boundary.
- SDK defaults discover resources and tools. Use an explicit resource loader, dedicated agent directory, and tool allowlist; do not inherit personal extensions, MCP, bash, read/write, or project instructions.
- Pi's working directory and prompts are not a sandbox. Restrict the operating-system account and exposed services as well.

### Google Live

- Stateful WebSocket audio and function calling fit this bridge. Functions are executed by our host and return correlated tool responses; Gemini does not execute our Pi commands itself.
- Input: raw PCM signed 16-bit little-endian, 16 kHz. Output: PCM 24 kHz. Explicitly resample device audio, normally 48 kHz.
- Wait for setup completion. Handle interruptions, tool-call cancellation, connection expiry, usage reports, and disconnection independently.
- Transcription is a side channel and is not guaranteed to arrive in the same order as model turns. Do not send every transcript chunk to Pi or independently dispatch both transcripts and function calls.
- Google currently documents `gemini-3.8-live` as GA with `eu` availability; `gemini-live-2.5-flash-native-audio` is also documented, with a retirement date of December 13, 2026. Treat 3.8/eu as the candidate, subject to actual project access and a pinned SDK smoke test, not a deployment commitment.
- The published 24-language list does **not include Hungarian**. Multilingual marketing does not establish reliable Hungarian support. Real Hungarian commands, children's speech, and English/Spanish song titles are a first-stage acceptance gate.
- The retrieved references disagree in places about session limits, resumption windows, transcription modality configuration, and SDK naming during a product transition. Pin model, SDK, endpoint, and API version; verify the minimal working combination before building orchestration. Do not combine incompatible sample snippets.
- Resumption can retain audio/text session data server-side. MVP disables resumption and uses short sessions; this is not a blanket zero-retention claim about the provider.
- Live listening consumes input tokens even when no answer is spoken. Keep the cloud connection closed while idle.

### Wake word and cost

- openWakeWord supports local ARM64 inference and custom training, but officially supports English, not a ready-made Hungarian “Hé Gizi.” It is a candidate requiring pronunciation/child-voice validation, not a guaranteed solution. Compare a custom keyword model with another locally running keyword engine if needed.
- Google documents alerts-only budgets as non-enforcing. It also now references preview spend-cap budgets for supported services. Verify what currentlyai actually has and whether it covers the selected Live model; do not assume either that the user's limit is a hard cap or that hard caps do not exist.

## 4. Three interface designs

### A. Gemini calls app tools directly

Interface shape: `spotify_search`, `spotify_add_tracks`, `spotify_play`, later `light_set` declared directly to Live.

Example: speech → Gemini → `spotify_play({ playlistId })` → spoken result.

Hides audio/transport complexity behind a simple controller. Fewest model hops and lowest likely latency. However, Pi is no longer the executor, policy/tool catalogs get duplicated, and application orchestration lives in the speech model. Useful as a baseline, not the requested architecture.

### B. Gemini delegates to a dedicated Pi household worker — recommended

Live-facing interface: `ask_pi({ request: string })`. Optional conversation-ending behavior can remain host controlled; avoid adding app tools to Gemini.

Example: Gemini calls `ask_pi({ request: "Add Farruko's Pepas to csajok and play it" })`; the host assigns identity, IDs, deadline and policy, invokes Pi, and returns a typed result. Gemini speaks the returned answer or clarification.

Internal bridge interface, illustrative rather than SDK code:

```ts
interface HouseholdAgent {
  submit(turn: HouseholdTurn): Promise<{ operationId: string }>;
  events(operationId: string): AsyncIterable<HouseholdEvent>;
  cancel(operationId: string): Promise<CancelOutcome>;
}

// Built by trusted host code, never accepted wholesale from Gemini.
type HouseholdTurn = {
  conversationId: string;
  turnId: string;
  request: string;
  policyContextId: string;
  deadlineMs: number;
};

type HouseholdEvent =
  | { type: 'progress'; stage: string }
  | { type: 'clarification'; question: string }
  | { type: 'approval_required'; approvalId: string }
  | { type: 'completed'; spokenReply: string; receiptIds: string[] }
  | { type: 'failed'; code: string; spokenReply: string }
  | { type: 'cancelled'; committedReceiptIds: string[] }
  | { type: 'outcome_unknown'; operationId: string };
```

Hides Pi lifecycle, retries, transcript handling, queues, policy and app credentials. Best match for “voice pipeline for Pi,” testable without audio. Costs an extra model round trip; needs good feedback and cancellation handling.

Implement the worker with the Pi TypeScript SDK in a separate service, using explicit resources and named tools. A child process is a crash boundary, not a security boundary by itself; deploy under a restricted account/sandbox. Keep the interface above transport-independent so RPC can replace the SDK host if operational isolation or a Python front end makes it preferable.

### C. Inject voice into the owner's running Pi conversation

Interface shape: a Pi extension receives voice turns and calls `pi.sendUserMessage`; events feed speech back. RPC is an alternative only if our host owns the long-lived RPC process—it does not magically attach to an arbitrary existing UI session.

Example: “Hé Gizi, continue what we were coding” enters the owner's session.

Hides almost no permission/context complexity. Excellent continuity for an authenticated owner, but coding context can leak into spoken responses, children can trigger powerful tools, and simultaneous terminal/voice turns conflict. Reserve for a separately authenticated owner mode; do not make it the family default.

## 5. Deployment and responsibility boundaries

```text
USB microphone / far-field mic array
           │
 local capture + wake/VAD service ── local mute button / indicator
           │ only after activation
           ▼
 Gizi coordinator + Google Gen AI SDK ── Vertex Live (explicit project)
           │ ask_pi + trusted request envelope
           ▼
 dedicated Pi household worker ── selected text model
           │ typed capability tools
           ▼
 policy + capability service + operation ledger
       ├── Spotify Web API ── Raspotify OmniWall ── PipeWire ── JBL
       └── future Home Assistant / explicit device adapters

 Verified Pi result ── Gemini speech ── local audio output
 Omni dashboard: status, transcript if enabled, owner approval, errors
```

Use Node/TypeScript for coordinator, Pi worker and capabilities to fit Omni and the current SDK. A small Python sidecar is acceptable for local wake detection/audio if that is the best supported ARM64 implementation. Communicate over permission-restricted Unix sockets; do not expose raw Pi RPC or microphone ingestion to the LAN.

Omni's dashboard is an optional view/controller, not the always-on audio process. Browser suspension or kiosk reload must not break wake detection. Do not reuse its terminal Socket.io channel as a household authority channel.

Keep GCP, Pi-model, and Spotify credentials separate. Only the necessary service can read each credential. Prefer short-lived Google credentials with a narrow runtime identity; choose the Pi's unattended authentication mechanism explicitly (not an unexamined full-owner ADC file or committed service-account key).

## 6. Voice lifecycle

1. **IDLE_LOCAL:** local wake/VAD only; no cloud audio. Small bounded RAM-only pre-roll, never a recording archive.
2. **CONNECTING:** detected “Hé Gizi”; show listening indicator and play a short local chime; duck the music; open Live. Buffer a bounded amount of command audio while connecting and discard on timeout. Only the short activation window may be uploaded, not accumulated room audio.
3. **LISTENING:** stream microphone PCM. Gemini may give a brief acknowledgement but must delegate requested actions. Host deduplicates function calls and maps them to the active turn. Transcriptions serve display/debugging, not an independent execution path.
4. **EXECUTING:** Pi gets a single request. It searches, asks a clarification, or invokes typed tools. Gemini has no direct app credentials. For MVP, one active Pi action; subsequent requests queue or explicitly cancel/replace it.
5. **SPEAKING / CLARIFYING:** return correlated Live function response with verified outcome or question. Play the short response. Follow-up answers retain the same short-lived Pi conversation and pending action context.
6. **FOLLOW_UP:** a short listening window (initial proposal: 8 seconds). Otherwise close Live, clear temporary buffers/context, restore audio, return to local idle.

Initial limits to tune: 10-second connection deadline, 30-second agent deadline, 120-second cloud session maximum, one active session, bounded audio buffers and retry count. Longer jobs later become explicit asynchronous operations, not an indefinitely held voice connection.

### Interruptions and failure

- Barge-in flushes queued/generated speech immediately. It does not imply that an API mutation was undone.
- `toolCallCancellation` cancels the mapped queued/in-flight operation where possible; pass AbortSignal to Pi and all adapters. A cancelled HTTP request can still have committed remotely.
- Once a mutation is sent, record `committed`, `failed`, or `outcome_unknown`. Reconcile unknown outcomes before retrying. Never re-add tracks simply because a WebSocket reconnected or a spoken response was interrupted.
- Do not return a late result on an obsolete Live call ID. Save its receipt; a new turn can ask for operation status without replaying it.
- If Live fails, close cleanly, restore audio and show a local error. Do not continue streaming or execute a partial transcription.
- A local mute control always stops microphone transmission. A deterministic local pause/mute path is a useful safety feature even when the cloud is unavailable.

### Acoustics

Prefer a USB microphone or mic array with a known Linux capture path. Start with push-to-talk and a quiet-room test. The JBL is a music output, not the microphone.

Initially pause/duck music during commands. Restore only state that the bridge changed, not a newer user-requested volume/playback state. When a request starts music, speak the acknowledgement before releasing the duck/pause lease.

Bluetooth playback latency complicates acoustic echo cancellation and barge-in. A separate wired/USB voice speaker near a far-field mic is preferable; shared JBL output is possible only after testing. Never feed the PipeWire monitor back as user input. Noise suppression is not echo cancellation. If full-duplex fails, explicitly ship half-duplex rather than claiming interruption support.

## 7. Spotify: tool plus skill, not skill alone

Create a small `pi-household` package with an executable Spotify extension and optional workflow skill. Both the owner Pi and household worker can load the same adapter, with different server-enforced permissions.

Proposed initial Pi tools:

- `spotify_search_tracks({ query, limit })` → bounded candidates with IDs, artists, titles, explicit-content flag and availability.
- `spotify_get_playlist({ playlistId })` → state/snapshot and bounded items.
- `spotify_create_playlist({ name, trackIds })` → private-by-default playlist plus receipt. Multi-step creation/addition reports partial failure rather than hiding an empty playlist.
- `spotify_add_tracks({ playlistId, trackIds })` → receipt and verified resulting state.
- `spotify_control_playback({ action, playlistId?, trackId?, volumePercent? })` → status for configured OmniWall only.
- Optional playlist-list/search tool for resolving a name; application aliases bind `csajok` to its known ID.

Tool schemas are validated, but adapter authorization is independent of model choices. No arbitrary URLs, shell commands, device fallback, or caller-supplied role/approval tokens in model-facing schemas.

The skill teaches: resolve title/artist or lyric fragments; clarify ambiguous matches; prefer originals; apply configured explicit-content policy; keep replies short and Hungarian when requested; never claim playback started just because a playlist was created. Skills guide behavior; tools enforce it.

The capability service owns:

- PKCE refresh with rotation handling, atomic credential writes, restrictive permissions and serialized refresh.
- 401 refresh once; respect 429 `Retry-After`; bound retries and handle 403/missing scopes/device unavailable explicitly.
- Current API contract tests. The successfully exercised endpoints were `POST /me/playlists` and `POST /playlists/{id}/items`; do not copy older endpoints blindly.
- Operation ledger and locks per account/playlist. Persist request/operation IDs before sending mutations; use receipts and playlist snapshots/item comparisons for reconciliation. Spotify does not supply a universal exactly-once transaction; an ambiguous create must not be blindly repeated.
- Deduplication by trusted conversation/turn/tool call mapping. A later deliberate “add it again” is different from a retry of the same request.
- No public-playlist creation, deletion, or edits outside allowed family playlists in initial child mode.
- Explicit/clean-track policy and a volume ceiling configured by the owner, not inferred from a voice.

## 8. Authorization and privacy

Default every room voice to **household/child permissions**. Wake words and voice recognition are not proof of identity. A TV, guest, or recording can activate the system.

Allowed by default: search, play/pause/skip, capped volume, and changes to owner-approved family playlists. Decide explicitly whether creating additional private playlists is allowed.

Owner approval required for broader account changes or new device access. Dangerous device classes (locks, alarms, ovens, purchases), shell execution, software installation, credential access and arbitrary code are absent from the child tool catalog—not merely discouraged in the prompt.

Approval must arrive through an authenticated owner channel, bound to exact operation/arguments, short expiry, and single use. Saying “I'm Dad” or “yes” does not elevate permissions. Any higher-risk plan revision invalidates its approval.

Future home integration exposes typed allowlisted entity operations, preferably through Home Assistant; not a generic unrestricted service-call tool.

Audio is local before activation. No raw audio saved by default. Keep only minimal action receipts, timings and errors; transcripts optional with short retention and parental control. No biometric identification or emotion profiling needed. Do not copy this development chat into household context.

Check provider terms and the desired treatment of children's speech before deployment. Disabling Live resumption reduces retained session state but does not establish total provider zero retention; document the actual account settings and terms.

## 9. Cost controls

Use currentlyai explicitly; confirm the exact project ID, region, billing scope and runtime identity. Inspect existing cost limits before relying on them or changing anything.

Local controls apply regardless of delayed billing alerts:

- One active session; cloud connection only after wake; short idle/session deadlines.
- Daily audio-minute allowance, daily model-token allowance, and requests-per-minute cap, persisted across restarts.
- Reserve estimated cost before a request; count both Pi text-model and Live audio use; reconcile usage reports. Keep a safety margin because provider billing and local estimates may differ.
- Stop new cloud sessions when the configured local allowance is exhausted; local chime/UI explains why. No automatic switch to an unbudgeted provider.
- Cap agent/tool loops, output length, retries and long operations.
- Record wake frequency, audio duration, model tokens, latency and errors without audio content.

A local allowance limits this bridge, not all spending by other users of the GCP project. Pi usage on a different provider is outside GCP's budget. Using Vertex for the Pi text model can consolidate billing, but Live itself is not a replacement for Pi's normal text/tool model provider.

## 10. Delivery plan and acceptance tests

### Stage 0 — prove the risky assumptions

- Confirm microphone hardware and capture path. Test children speaking Hungarian, mixed-language track names, and “Hé Gizi,” with and without JBL music.
- Verify selected Live model/region/SDK authentication, PCM round trip, input transcription, tool call/response, interruption, and usage reporting in currentlyai.
- Verify Hungarian quality before committing to Live for production. If it fails, evaluate a documented Hungarian STT + Pi + Hungarian TTS path behind the same bridge interface; do not silently change the chosen provider.
- Inspect actual cost controls and consent/privacy requirements. Set a small explicit test allowance.

### Stage 1 — reusable Spotify tools, text only

Package the working API flow, consolidate credentials, add refresh/backoff/operation ledger, and register tools in an isolated Pi session. Test “add Pepas to csajok” without voice. Verify receipts, playlist contents and exact playback device. Test failures and replay; do not use the children's real playlist as destructive test data.

### Stage 2 — push-to-talk end-to-end

Local button/keyboard activation → Live `ask_pi` → Pi tools → verified spoken result. Include clarification, cancellation and device-offline behavior. No always-on cloud stream.

### Stage 3 — local wake word and audio quality

Train/evaluate the custom keyword. Measure misses by speaker/distance and false activations during several hours of music/TV. Add chime, mute indicator, bounded pre-roll, music ducking and follow-up timing. Ship wake mode only after agreed thresholds are met; push-to-talk remains available.

### Stage 4 — household hardening

Separate service identities and credential stores; authenticated owner approval; restart recovery; persisted limits; injection/replay tests; interrupted mutation reconciliation. Ensure disconnect does not leave the mic streaming or music permanently ducked.

### Stage 5 — first home device

Start with one low-risk light and an explicit entity allowlist. Test authorization independently of Pi and Gemini. Expand only after validating the same receipts, cancellation and approval model.

End-to-end targets to agree (not promises): immediate local acknowledgement, ordinary commands completing in a few seconds, no repeated mutations from replay, zero shell access from voice, and no cloud microphone traffic while idle.

## 11. Decisions needed before implementation

1. Is Hungarian the primary language, with English/Spanish song names mixed in?
2. Which microphone will be attached, and should Gizi speak through JBL or a separate small speaker?
3. Is a separate child-safe Pi session acceptable, with owner-only coding access kept separate?
4. What is the exact GCP project ID and desired daily/monthly bridge allowance? Are existing limits alerts or enforced spend caps?
5. What may the daughters change: only existing approved playlists, or also create private playlists? Explicit tracks allowed or clean-only?

## Sources

Installed Pi docs, read together with SDK full-control/tools/extensions examples and the hello extension:

- `docs/sdk.md`, `docs/cli-integration.md`, `docs/rpc.md`
- `docs/extensions.md`, `docs/skills.md`, `docs/packages.md`
- `docs/configuration.md`, `docs/providers.md`, `docs/security.md`, `docs/containerization.md`
- Root: `/home/pi/.local/share/pi-releases/slots/blue/pi-web/node_modules/@earendil-works/pi-coding-agent/`

Google's current cloud.google.com links redirected to the following documentation:

- [Live overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api)
- [Live reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/multimodal-live)
- [Sessions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/start-manage-session)
- [Function calling and other capabilities](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-gemini-capabilities)
- [Languages, voices and VAD](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-language-voice)
- [SDK tutorial](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/get-started-sdk)
- [Gemini 3.8 Live](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-live)
- [Gemini 2.5 Live](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-live-api)
- [Google Gen AI JavaScript SDK](https://googleapis.github.io/js-genai/release_docs/index.html)
- [Budgets and alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [openWakeWord capabilities and language limitations](https://github.com/dscripka/openWakeWord)
