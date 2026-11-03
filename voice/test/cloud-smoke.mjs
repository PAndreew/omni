// Opt-in, billable Hungarian STT -> Pi -> TTS integration test.
// Real Spotify reads are allowed; playback mutations are intercepted so the
// currently playing music and actual playlists are never changed by this test.
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { googleClient } from '../google.js';
import { connectRecordedSpeech, transcribeAudio, synthesizeHungarian } from '../speech.js';
import { createVoiceServer } from '../server.js';
import { createHouseholdAgent } from '../agent.js';
import { SpotifyController } from '../spotify.js';
import { PcmResampler } from '../../client/public/gizi/pcm-core.js';
import { HouseholdMetadata } from '../metadata.js';
const directory = await mkdtemp(path.join(os.tmpdir(), 'gizi-cloud-smoke-'));
let ws, voice;
try {
  const client = await googleClient({ project: 'currentlyai', location: 'eu' });
  const metadata = new HouseholdMetadata(path.resolve('metadata.json'));
  const controller = new SpotifyController({ tokenPath: path.join(os.homedir(), '.config/omni-spotify/token.json'), stateDir: directory });
  const plays = [];
  const readOnly = {
    request: (endpoint, signal) => controller.request(endpoint, signal),
    tracks: signal => controller.tracks(signal),
    add: async () => { throw new Error('Smoke test cannot edit playlists.'); },
    playback: async (action, _signal, _callId, trackId) => {
      plays.push({ action, trackId });
      return { accepted: true, device: 'OmniWall', action, trackId, testOnly: true };
    },
  };
  voice = createVoiceServer({ stateDir: directory, sessionSeconds: 120, accessKey: 'smoke-key', connect: async (emit, closed) => {
    const agent = await createHouseholdAgent({ controller: readOnly, metadata, stateDir: directory });
    return connectRecordedSpeech({ agent, emit, closed,
      transcribe: async (pcm, signal) => transcribeAudio({ client, pcm, signal, customVocabulary: await metadata.vocabulary() }),
      synthesize: (text, signal) => synthesizeHungarian({ text, project: 'currentlyai', signal }),
    });
  } });
  voice.server.listen(0, '127.0.0.1'); await once(voice.server, 'listening');
  const origin = `http://127.0.0.1:${voice.server.address().port}`;
  ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/gizi/socket`, { origin });
  const events = [];
  ws.on('message', data => events.push(JSON.parse(data.toString())));
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'auth', key: 'smoke-key' }));
  const until = async predicate => {
    const deadline = Date.now() + 65000;
    while (!predicate()) {
      const error = events.find(event => event.type === 'error');
      if (error) throw new Error(error.message);
      if (Date.now() > deadline) throw new Error('Voice response timed out');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  await until(() => events.some(event => event.type === 'ready'));
  async function utterance(sentence) {
    const source = await synthesizeHungarian({ text: sentence, project: 'currentlyai', signal: AbortSignal.timeout(20000) });
    const samples = new Float32Array(source.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = source.readInt16LE(i * 2) / 32768;
    const frames = [], resampler = new PcmResampler(24000);
    resampler.push(samples, buffer => frames.push(Buffer.from(buffer)));
    resampler.flush(buffer => frames.push(Buffer.from(buffer)));
    const pcm = Buffer.concat(frames);
    assert.ok(pcm.length <= 480000, 'Fixture must fit the recording limit');
    const start = events.length;
    ws.send(JSON.stringify({ type: 'start' }));
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      ws.send(pcm.subarray(offset, offset + 3200));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    ws.send(JSON.stringify({ type: 'end' }));
    await until(() => events.slice(start).some(event => event.type === 'turn_complete'));
    const turn = events.slice(start);
    assert.ok(turn.some(event => event.type === 'audio'), 'Expected Hungarian spoken response');
    const transcript = turn.filter(event => event.type === 'transcript' && event.who === 'user').map(event => event.text).join('');
    const reply = turn.filter(event => event.type === 'transcript' && event.who === 'assistant').map(event => event.text).join('');
    console.log('Transcript:', transcript); console.log('Reply:', reply);
    return { transcript, reply };
  }
  const expectedCount = (await controller.tracks(AbortSignal.timeout(10000))).length;
  const count = await utterance('Hány dal van a csajok lejátszási listán?');
  assert.match(count.transcript.toLowerCase(), /hány dal/);
  const hungarianNumbers = ['nulla', 'egy', 'két|kettő', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc', 'tíz'];
  assert.match(count.reply.toLowerCase(), new RegExp(`\\b${expectedCount}\\b|${hungarianNumbers[expectedCount] || '(?!)'}`));
  assert.equal(plays.length, 0, 'Count request must not change playback');
  const play = await utterance('Indítsd el Farruko Pepas című számát!');
  assert.match(play.transcript.toLowerCase(), /pepas/);
  assert.equal(plays.length, 1, 'Play request must dispatch exactly once');
  assert.equal(plays[0].action, 'play_track');
  assert.match(plays[0].trackId, /^[A-Za-z0-9]{22}$/);
  const track = await controller.request(`tracks/${plays[0].trackId}`, AbortSignal.timeout(10000));
  assert.equal(track.name, 'Pepas'); assert.ok(track.artists.some(artist => artist.name === 'Farruko'));
  const alias = await utterance('Indítsd el az órást!');
  assert.match(alias.transcript.toLowerCase(), /órás/);
  assert.equal(plays.length, 2);
  assert.deepEqual(plays[1], { action: 'play_track', trackId: '3uUuGVFu1V7jTQL60S1r8z' });
  assert.equal(alias.reply, '', 'Successful playback uses a chirp, not spoken text');
  console.log('Cloud PASS: Hungarian transcription, exact Pi request, verified playlist count, resolved named/alias play_track, spoken answers and local success chirps. Playback writes were intercepted.');
} finally { ws?.close(); voice?.close(); await rm(directory, { recursive: true, force: true }); }
