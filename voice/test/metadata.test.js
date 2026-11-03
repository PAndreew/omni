import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HouseholdMetadata, normalizeAlias } from '../metadata.js';

test('normalizes Hungarian aliases and resolves órás exactly', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gizi-metadata-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'metadata.json');
  await writeFile(file, JSON.stringify({ version: 1, entries: [{ kind: 'track', spotifyId: '4255amV4enzl28KAn16rUO', title: 'Are You With Me', artists: ['Lost Frequencies'], aliases: ['órás', 'órást'], notes: 'nickname' }] }));
  const store = new HouseholdMetadata(file);
  assert.equal(normalizeAlias('  ÓRÁS!?  '), 'órás');
  const result = await store.resolve('Órás');
  assert.equal(result.spotifyId, '4255amV4enzl28KAn16rUO');
  assert.equal(result.title, 'Are You With Me');
  assert.equal(await store.resolve('oras'), null, 'do not silently discard meaningful Hungarian accents');
  assert.ok((await store.vocabulary()).includes('órás'));
  assert.equal((await store.matchRequest('Indítsd el az órást!'))[0].spotifyId, '4255amV4enzl28KAn16rUO');
  assert.deepEqual(await store.matchRequest('Indítsd el a félórást!'), [], 'aliases match complete normalized words only');
});

test('production metadata resolves piros villámló bácsi to Prophecy of Ragnarök', async () => {
  const store = new HouseholdMetadata(new URL('../metadata.json', import.meta.url));
  const result = await store.resolve('piros villámló bácsi');
  assert.equal(result.spotifyId, '4kpWVGdFjBSoCkIcHVlTqn');
  assert.equal(result.title, 'Prophecy of Ragnarök');
  assert.deepEqual(result.artists, ['Brothers of Metal']);
  assert.equal((await store.matchRequest('Indítsd el a piros villámló bácsit!'))[0].spotifyId, '4kpWVGdFjBSoCkIcHVlTqn');
});

test('rejects duplicate aliases and invalid Spotify IDs', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gizi-metadata-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const entries of [
    [{ kind: 'track', spotifyId: 'bad', title: 'x', aliases: ['x'] }],
    [{ kind: 'track', spotifyId: '3uUuGVFu1V7jTQL60S1r8z', title: 'x', aliases: ['órás'] }, { kind: 'playlist', spotifyId: '24zkMDCr0Km6Qc47GYZvhn', title: 'y', aliases: ['ÓRÁS'] }],
  ]) {
    const file = path.join(dir, Math.random() + '.json'); await writeFile(file, JSON.stringify({ version: 1, entries }));
    await assert.rejects(new HouseholdMetadata(file).load(), /Invalid|Duplicate/);
  }
});

test('adds metadata atomically and reloads in-memory state', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gizi-metadata-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'metadata.json'); await writeFile(file, JSON.stringify({ version: 1, entries: [] }));
  const store = new HouseholdMetadata(file);
  await store.add({ kind: 'playlist', spotifyId: '24zkMDCr0Km6Qc47GYZvhn', title: 'csajok', aliases: ['csajok'] });
  assert.equal((await store.resolve('csajok')).kind, 'playlist');
  assert.equal(JSON.parse(await readFile(file)).entries.length, 1);
});
