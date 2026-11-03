import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const spotifyId = /^[A-Za-z0-9]{22}$/;
export function normalizeAlias(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('hu-HU').replace(/[.,!?;:"'„”()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
}
export class HouseholdMetadata {
  constructor(file) { this.file = file; this.cache = null; }
  validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Invalid household metadata.');
    const aliases = new Set();
    for (const entry of data.entries) {
      if (!['track', 'playlist'].includes(entry.kind) || !spotifyId.test(entry.spotifyId) || typeof entry.title !== 'string' || !Array.isArray(entry.aliases) || !entry.aliases.length) throw new Error('Invalid household metadata entry.');
      for (const alias of entry.aliases) {
        const normalized = normalizeAlias(alias);
        if (!normalized || aliases.has(normalized)) throw new Error(`Duplicate or invalid household alias: ${alias}`);
        aliases.add(normalized);
      }
    }
    return data;
  }
  async load() { if (!this.cache) this.cache = this.validate(JSON.parse(await readFile(this.file, 'utf8'))); return this.cache; }
  async resolve(alias) {
    const normalized = normalizeAlias(alias);
    const matches = (await this.load()).entries.filter(entry => entry.aliases.some(candidate => normalizeAlias(candidate) === normalized));
    return matches.length === 1 ? { ...matches[0], matchedAlias: normalized } : null;
  }
  async vocabulary() { return [...new Set((await this.load()).entries.flatMap(entry => [entry.title, ...(entry.artists || []), ...entry.aliases]))].slice(0, 100); }
  async matchRequest(request) {
    const normalized = ` ${normalizeAlias(request)} `;
    return (await this.load()).entries.flatMap(entry => {
      const matchedAlias = entry.aliases.find(alias => normalized.includes(` ${normalizeAlias(alias)} `));
      return matchedAlias ? [{ kind: entry.kind, spotifyId: entry.spotifyId, title: entry.title, artists: entry.artists || [], alias: normalizeAlias(matchedAlias), notes: entry.notes || '' }] : [];
    });
  }
  async add(entry) {
    const data = await this.load();
    this.validate({ ...data, entries: [...data.entries, entry] });
    const next = { ...data, entries: [...data.entries, entry] };
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file); this.cache = next;
    return entry;
  }
}
