import { randomUUID } from 'node:crypto';

// Session-only experiment: restarting the voice service always disables radio.
export class SimilarRadio {
  constructor(controller) {
    this.controller = controller;
    this.enabled = false;
    this.recent = [];
    this.attempted = new Set();
    this.note = 'Off';
  }
  status() { return { enabled: this.enabled, note: this.note }; }
  configure(enabled) {
    this.enabled = enabled;
    this.note = enabled ? 'Waiting for OmniWall playback; adds only to an empty queue.' : 'Off (already queued songs remain).';
    if (!enabled) this.abort?.abort();
    if (enabled && !this.timer) {
      this.timer = setInterval(() => void this.tick(), 15000);
      this.timer.unref?.();
    }
    if (!enabled) { clearInterval(this.timer); this.timer = null; }
    return this.status();
  }
  async tick() {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]);
    const request = (endpoint, options) => this.controller.request(endpoint, signal, options);
    try {
      const state = await request('me/player');
      const track = state.item;
      if (!state.is_playing || state.device?.name !== 'OmniWall' || state.device.is_restricted || track?.type !== 'track' || state.repeat_state !== 'off') return;
      if (track.id !== this.current) {
        this.current = track.id;
        this.recent = [...this.recent, track.id].slice(-80);
        this.attempted.clear();
      }
      if (this.attempted.has(track.id)) return;
      const queue = await request('me/player/queue');
      if (!Array.isArray(queue.queue) || queue.queue.length) { this.note = 'Existing queue takes priority.'; return; }
      let candidates = [], source = 'Spotify recommendations';
      try {
        candidates = (await request(`recommendations?seed_tracks=${track.id}&limit=10`)).tracks || [];
      } catch (error) {
        // Do not bypass rate limiting, authorization failures or network errors.
        if (!/Spotify returned (403|404)\./.test(error.message)) throw error;
        source = 'Same-artist fallback (recommendations unavailable)';
        const name = track.artists?.[0]?.name;
        if (!name) throw new Error('No artist metadata available.');
        const q = `artist:"${name.replaceAll('"', '')}"`;
        candidates = (await request(`search?${new URLSearchParams({ q, type: 'track', limit: '10' })}`)).tracks?.items || [];
      }
      const next = candidates.find(item => item?.type === 'track' && item.uri && !item.is_local && item.is_playable !== false && !item.explicit && !this.recent.includes(item.id));
      if (!next) { this.note = 'No new non-explicit matches found.'; this.attempted.add(track.id); return; }
      const latest = await request('me/player');
      const latestQueue = await request('me/player/queue');
      if (!this.enabled || !latest.is_playing || latest.item?.id !== track.id || latest.device?.id !== state.device.id || !Array.isArray(latestQueue.queue) || latestQueue.queue.length) return;
      // Never blindly retry an ambiguous queue mutation.
      this.attempted.add(track.id);
      await request(`me/player/queue?${new URLSearchParams({ uri: next.uri, device_id: state.device.id })}`, { method: 'POST', operationId: randomUUID() });
      this.recent = [...this.recent, next.id].slice(-80);
      this.note = `${source}: queued ${next.name}`;
    } catch (error) { if (this.enabled) this.note = error.message; }
    finally { this.busy = false; }
  }
}
