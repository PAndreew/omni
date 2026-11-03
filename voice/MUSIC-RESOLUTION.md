# Voice music resolution

Household aliases have first priority. Otherwise, `spotify_search_tracks` searches a short query with at most two variants: adjacent repetition removed, then the original. Real repeated-word titles such as “Bye Bye Bye” therefore remain searchable. Each variant requests up to ten Spotify tracks; duplicate album copies of the same title/artist are removed.

If Spotify is still unclear, `music_web_search` queries the fixed public MusicBrainz recording-search endpoint (title and optional artist). This is a music web-catalogue fallback, not general web browsing. No keys required. Queries are bounded, escaped, timed out, rate-spaced, and redirects blocked; results are treated as untrusted data. Only title/artist information is sent, never raw recordings or Spotify authorization. Returned MusicBrainz IDs/URLs are not Spotify IDs.

The agent must resolve candidates through Spotify and use `request_music_confirmation` before uncertain playback or additions. Deterministic code enforces the confirmation boundary, retains uncertainty across repeated/artist-narrowed searches, rejects invented Spotify IDs, and blocks other mutations after a confirmation question has been queued. Explicitly named artist/title pairs and trusted aliases can remain one-step; ambiguous, approximate and web-derived candidates ask first. Read-only status queries are still permitted while awaiting an answer.

Pending candidate/operation and a small recent-candidate context are stored only in RAM and expire for use after two minutes. Expired data is discarded on the next turn or backend restart. A pending confirmation is armed only when the host actually returns its confirmation question, not merely when the model queues a tool call. Because the current system is one shared household rather than multi-user SaaS, this context is household-scoped, not per-person. It survives a new wake-word voice connection but not a backend restart. A bounded exact affirmative (“igen”, “yes”, “igen kérem”, etc.) consumes that pending request before acting; a negated/qualified answer does not count as confirmation. Playback still targets only OmniWall. Confirmed playlist additions still target only csajok. Confirmation receipts use fresh operation IDs, and unknown mutations are never retried automatically.

Examples:

- “sorry, sorry papi” → searches “sorry papi” and the original; can find the Bad Bunny/ABRA song alongside Topic/Becky G, instead of silently choosing one.
- Same title with multiple artists → ask which artist or confirm a specific title/artist.
- Web identifies a candidate → resolve Spotify ID → spoken confirmation → later user yes → one mutation.
- Failed catalogue search → ask for the artist, not invent a track ID.

Tests: `cd voice && npm test`. They exercise stutter variants, real repeated-word titles, web-source restrictions, authority checks, confirmation expiry, artist-filter bypass prevention, alias precedence and confirmation across a fresh actual Pi SDK agent. A live read-only agent check for “Játszd le: sorry, sorry papi” produced a title/artist confirmation and zero playback attempts.
