import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MusicResolution, musicQueryVariants, searchMusicWeb } from '../music-resolution.js';
import { spotifyTools } from '../spotify.js';
import { createHouseholdAgent } from '../agent.js';

const bunny = { id: '1234567890123456789012', title: 'SORRY PAPI', artists: ['Bad Bunny', 'ABRA'] };
const topic = { id: 'abcdefghijklmnopqrstuv', title: 'Sorry Papi', artists: ['Topic', 'Becky G'] };
const signal = () => AbortSignal.timeout(10000);

test('stutter cleanup preserves original repeated-word song queries', () => {
  assert.deepEqual(musicQueryVariants('sorry, sorry papi'), ['sorry papi', 'sorry sorry papi']);
  assert.deepEqual(musicQueryVariants('Bye Bye Bye'), ['Bye', 'Bye Bye Bye']);
  assert.deepEqual(musicQueryVariants('SORRY sorry papi'), ['SORRY papi', 'SORRY sorry papi']);
});

test('voice search uses bounded cleaned/original Spotify queries and deduplicates album copies', async () => {
  const resolution = new MusicResolution(); resolution.beginTurn('Play sorry, sorry papi');
  const queries = []; let plays = 0;
  const controller = { request: async endpoint => {
    const params = new URLSearchParams(endpoint.split('?')[1]); queries.push(params.get('q'));
    assert.equal(params.get('limit'), '10');
    return { tracks: { items: [topic, bunny, { ...topic, id: 'zzzzzzzzzzzzzzzzzzzzzz' }].map(item => ({ id: item.id, name: item.title, artists: item.artists.map(name => ({ name })) })) } };
  }, playback: async () => { plays++; return { accepted: true }; } };
  const tools = new Map(spotifyTools(controller, null, resolution).map(tool => [tool.name, tool]));
  const result = await tools.get('spotify_search_tracks').execute('search', { query: 'sorry, sorry papi' }, signal());
  assert.deepEqual(queries, ['sorry papi', 'sorry sorry papi']); assert.equal(result.details.tracks.length, 2);
  assert.ok(result.details.tracks.every(item => item.requiresConfirmation));
  await assert.rejects(tools.get('spotify_playback').execute('play', { action: 'play_track', trackId: bunny.id }, signal()), /explicit user confirmation/);
  assert.equal(plays, 0); assert.match(resolution.questionThisTurn, /Bad Bunny/);
  await assert.rejects(tools.get('spotify_playback').execute('bypass', { action: 'resume' }, signal()), /Wait for the user/);
  resolution.armConfirmation();
  const confirmed = resolution.beginTurn('igen'); assert.equal(confirmed.id, bunny.id);
  await tools.get('spotify_playback').execute('confirmed-play', { action: 'play_track', trackId: bunny.id }, signal());
  assert.equal(plays, 1);
});

test('confirmation accepts only an explicit later yes, expires, and rejects invented IDs', () => {
  const resolution = new MusicResolution(); resolution.beginTurn('Play Sorry Papi');
  resolution.recordTracks([bunny, topic], ['Sorry Papi']);
  resolution.requestConfirmation(bunny.id); resolution.armConfirmation();
  assert.equal(resolution.beginTurn('igen, de inkább valami mást'), null);
  resolution.recordTracks([bunny], ['Sorry Papi']); resolution.requestConfirmation(bunny.id);
  resolution.armConfirmation(); resolution.pending.at -= 121000; assert.equal(resolution.beginTurn('yes'), null);
  assert.throws(() => resolution.assertPlay('zzzzzzzzzzzzzzzzzzzzzz'), /not resolved/);
  resolution.recordTracks([bunny], ['Sorry Papi']); resolution.requestConfirmation(bunny.id);
  assert.equal(resolution.beginTurn('yes'), null, 'a queued but never returned confirmation question must not authorize playback');
  resolution.beginTurn('Play the Bad Bunny Sorry Papi'); resolution.recordTracks([bunny, topic], ['Sorry Papi']);
  assert.doesNotThrow(() => resolution.assertPlay(bunny.id), 'artist explicitly named by user resolves ambiguity');
  resolution.usedWeb = true;
  assert.throws(() => resolution.assertPlay(bunny.id), /confirmation/, 'web identification still requires confirmation');
});

test('guessed artist filters and repeated searches cannot bypass confirmation', () => {
  const resolution = new MusicResolution(); resolution.beginTurn('Play Sorry Papi');
  resolution.recordTracks([bunny], ['Sorry Papi Bad Bunny']);
  assert.throws(() => resolution.assertPlay(bunny.id), /confirmation/);
  resolution.beginTurn('Play Sorry Papi'); resolution.recordTracks([bunny, topic], ['Sorry Papi']);
  resolution.recordTracks([bunny], ['Sorry Papi']);
  assert.throws(() => resolution.assertPlay(bunny.id), /confirmation/);
  resolution.beginTurn('Play Sorry Papi, not Topic, Bad Bunny'); resolution.recordTracks([bunny, topic], ['Sorry Papi']);
  assert.throws(() => resolution.assertPlay(topic.id), /confirmation/);
});

test('trusted aliases retain priority and additions keep their original operation', () => {
  const resolution = new MusicResolution(); resolution.beginTurn('az órás', [{ kind: 'track', spotifyId: bunny.id }]);
  assert.doesNotThrow(() => resolution.assertPlay(bunny.id));
  resolution.beginTurn('Add Sorry Papi to csajok'); resolution.recordTracks([bunny, topic], ['Sorry Papi']);
  assert.throws(() => resolution.assertPlay(bunny.id, 'add'), /confirmation/);
  resolution.armConfirmation();
  assert.equal(resolution.beginTurn('igen kérem').operation, 'add');
});

test('music web search is fixed-host read-only catalogue data, with no Spotify IDs', async () => {
  let url;
  const result = await searchMusicWeb({ title: 'sorry, sorry papi', signal: signal(), fetchImpl: async (input, options) => {
    url = new URL(input); assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
    return new Response(JSON.stringify({ recordings: [{ id: '12345678-1234-1234-1234-123456789abc', title: 'SORRY PAPI', score: 100, 'artist-credit': [{ name: 'Bad Bunny' }, { name: 'ABRA' }] }] }));
  } });
  assert.equal(url.hostname, 'musicbrainz.org'); assert.equal(url.searchParams.get('query'), 'recording:"sorry papi"');
  assert.equal(result.requiresUserConfirmation, true); assert.equal(result.requiresSpotifyResolution, true);
  assert.equal(result.candidates[0].title, 'SORRY PAPI'); assert.equal(result.candidates[0].spotifyId, undefined);
  await assert.rejects(searchMusicWeb({ title: 'query', signal: signal(), fetchImpl: async () => new Response('', { status: 503 }) }), /unavailable/);
});

test('web tool cannot run before Spotify search', async () => {
  const resolution = new MusicResolution(); resolution.beginTurn('Play Sorry Papi');
  const tool = spotifyTools({}, null, resolution).find(tool => tool.name === 'music_web_search');
  await assert.rejects(tool.execute('web', { title: 'Sorry Papi' }, signal()), /Spotify search first/);
  resolution.usedWeb = true;
  const playback = spotifyTools({}, null, resolution).find(item => item.name === 'spotify_playback');
  await assert.rejects(playback.execute('bypass', { action: 'play_csajok' }, signal()), /cannot authorize unrelated/);
});

test('explicit confirmation works across a fresh Pi voice agent without a model request', async t => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'beezy-confirm-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const resolution = new MusicResolution(); resolution.beginTurn('Play Sorry Papi');
  resolution.recordTracks([bunny, topic], ['Sorry Papi']); resolution.requestConfirmation(bunny.id); resolution.armConfirmation();
  const calls = [];
  const controller = { playback: async (...args) => { calls.push(args); return { accepted: true }; } };
  const agent = await createHouseholdAgent({ controller, stateDir, resolution, authPath: path.join(stateDir, 'auth.json'), provider: 'openai-codex', modelId: 'gpt-6-astra' });
  t.after(() => agent.dispose());
  const result = await agent.ask('Igen!', signal());
  assert.equal(result.feedback, 'chirp'); assert.equal(calls.length, 1); assert.equal(calls[0][3], bunny.id);
  assert.equal(resolution.pending, null, 'confirmation is consumed before mutation');
});
