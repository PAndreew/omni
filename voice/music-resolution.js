import { setTimeout as delay } from 'node:timers/promises';

export function musicQueryVariants(query) {
  const original = query.normalize('NFKC').replace(/[,\s]+/g, ' ').trim();
  const words = original.split(' ');
  const cleaned = words.filter((word, index) => index === 0 || word.toLowerCase() !== words[index - 1].toLowerCase()).join(' ');
  return [...new Set([cleaned, original])].filter(Boolean).slice(0, 2);
}
const compare = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mentions = (text, phrase) => (` ${compare(text)} `).includes(` ${compare(phrase)} `);
const identity = track => `${compare(track.title)}|${track.artists.map(compare).sort().join('|')}`;
const affirmative = request => /^(?:igen|yes|yes please|igen azt|igen ez az|igen kerem|igen kerlek|igen legy szives|igen jatszd le|igen inditsd|igen inditsd el|azt kerem|pontosan|mehet|rendben|ok|oke)$/.test(compare(request));

export class MusicResolution {
  constructor() { this.pending = null; this.tracks = new Map(); this.trusted = new Set(); this.request = ''; this.usedWeb = false; }
  beginTurn(request, metadataMatches = []) {
    this.context = Date.now() - (this.lastSearchAt || 0) < 120000 ? { previousRequest: this.request, candidates: [...this.tracks.values()].slice(0, 5).map(({ id, title, artists, fromWeb, requiresConfirmation }) => ({ id, title, artists, fromWeb: fromWeb || this.usedWeb, requiresConfirmation })) } : null;
    this.request = request; this.usedWeb = false; this.searched = false; this.questionThisTurn = null;
    this.tracks.clear(); this.trusted = new Set(metadataMatches.filter(item => item.kind === 'track').map(item => item.spotifyId));
    const pending = this.pending;
    this.pending = null;
    this.confirmed = pending && pending.armed && Date.now() - pending.at < 120000 && affirmative(request) ? { ...pending.track, operation: pending.operation } : null;
    if (this.confirmed) this.tracks.set(this.confirmed.id, { ...this.confirmed, requiresConfirmation: false });
    return this.confirmed;
  }
  recordTracks(tracks, variants) {
    this.searched = true; this.lastSearchAt = Date.now();
    const ambiguous = new Set(tracks.map(identity)).size > 1;
    return tracks.map(track => {
      const prior = this.tracks.get(track.id);
      const recent = this.context?.candidates.find(item => identity(item) === identity(track));
      const titleNamedByUser = mentions(this.request, track.title) || mentions(this.context?.previousRequest || '', track.title);
      const guessedArtistFilter = track.artists.some(artist => compare(artist).length >= 3 && mentions(variants[0], artist) && !mentions(this.request, artist));
      const fromWeb = this.usedWeb || prior?.fromWeb || recent?.fromWeb || false;
      const candidate = { ...track, fromWeb, approximate: !titleNamedByUser,
        requiresConfirmation: Boolean(fromWeb || prior?.requiresConfirmation || recent?.requiresConfirmation || ambiguous || guessedArtistFilter || variants.length > 1 || !titleNamedByUser) };
      this.tracks.set(track.id, candidate);
      return candidate;
    });
  }
  requestConfirmation(id, operation = 'play') {
    const track = this.tracks.get(id);
    if (!track) throw new Error('Resolve the candidate with Spotify search first.');
    const question = `${track.artists.join(', ')} – ${track.title}. ${operation === 'add' ? 'Ezt adjam a csajok listához?' : 'Ezt indítsam?'}`;
    this.pending = { track, operation, at: Date.now(), armed: false }; this.questionThisTurn = question;
    return { needsConfirmation: true, question, operation, trackId: id, title: track.title, artists: track.artists };
  }
  armConfirmation() { if (this.pending && this.questionThisTurn) this.pending.armed = true; }
  assertPlay(id, operation = 'play') {
    if (this.trusted.has(id)) return;
    const track = this.tracks.get(id);
    if (!track) throw new Error('Track ID was not resolved by a permitted search or trusted household alias.');
    const artistMentioned = !/\b(?:not|nem|ne|helyett|instead|rather)\b/.test(compare(this.request)) && track.artists.some(artist => compare(artist).length >= 3 && mentions(this.request, artist));
    if (id === this.confirmed?.id) return;
    if (this.usedWeb || track.fromWeb || (track.requiresConfirmation && (track.approximate || !artistMentioned))) {
      this.requestConfirmation(id, operation);
      throw new Error('This candidate requires explicit user confirmation in a later voice turn. Ask the returned question; do not play or add anything yet.');
    }
  }
}

let nextWebRequest = 0;
let webQueue = Promise.resolve();
export async function searchMusicWeb({ title, artist, signal, fetchImpl = fetch }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || (artist !== undefined && (typeof artist !== 'string' || artist.length > 100))) throw new Error('Invalid music search.');
  const operation = async () => {
    await delay(Math.max(0, nextWebRequest - Date.now()), undefined, { signal });
    nextWebRequest = Date.now() + 1100; // MusicBrainz requests must be spaced.
    const quote = text => `"${text.replace(/[\\"]/g, '\\$&')}"`;
    const query = `recording:${quote(musicQueryVariants(title)[0])}${artist ? ` AND artist:${quote(artist)}` : ''}`;
    const url = `https://musicbrainz.org/ws/2/recording/?${new URLSearchParams({ query, fmt: 'json', limit: '10' })}`;
    const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), headers: { 'User-Agent': 'Beezywall/1.0 (https://beezyai.net)', Accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) throw new Error('Music catalogue search is unavailable. Ask the user for the artist instead.');
    if (Number(response.headers.get('content-length')) > 262144) throw new Error('Music search response too large.');
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 262144) throw new Error('Music search response too large.');
    const data = JSON.parse(raw);
    const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').slice(0, 200) : '';
    return { source: 'MusicBrainz public music catalogue', requiresSpotifyResolution: true, requiresUserConfirmation: true,
      candidates: (data.recordings || []).slice(0, 10).map(item => ({ title: text(item.title), artists: (item['artist-credit'] || []).map(credit => text(credit.name || credit.artist?.name)).filter(Boolean), score: Number(item.score) || 0,
        sourceUrl: /^[a-f0-9-]{36}$/.test(item.id || '') ? `https://musicbrainz.org/recording/${item.id}` : null })) };
  };
  const result = webQueue.catch(() => {}).then(operation);
  webQueue = result.then(() => {}, () => {});
  return result;
}
