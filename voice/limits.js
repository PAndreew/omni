import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export function validKey(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || actual.length > 128) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function sameOrigin(origin, host, extra = []) {
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && (url.host === host || extra.includes(url.origin)); }
  catch { return false; }
}
export class DailyBudget {
  constructor(directory, maximumSeconds = 900) {
    if (!Number.isInteger(maximumSeconds) || maximumSeconds < 1 || maximumSeconds > 86400) throw new Error('Invalid daily voice allowance.');
    this.directory = directory; this.maximumSeconds = maximumSeconds;
  }
  read(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'daily-budget.json');
    let usage = { day, seconds: 0 };
    try { const saved = JSON.parse(readFileSync(file, 'utf8')); if (saved.day === day) usage = saved; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Usage accounting unavailable; voice disabled.'); }
    if (!Number.isFinite(usage.seconds) || usage.seconds < 0) throw new Error('Usage accounting unavailable; voice disabled.');
    return { usage, file };
  }
  remaining(now = new Date()) { return Math.max(0, this.maximumSeconds - this.read(now).usage.seconds); }
  consume(seconds, now = new Date()) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid audio duration.');
    const { usage, file } = this.read(now);
    if (usage.seconds + seconds > this.maximumSeconds) throw new Error('Daily voice allowance reached. Try again tomorrow.');
    usage.seconds += seconds;
    writeFileSync(`${file}.tmp`, JSON.stringify(usage), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return usage;
  }
}
export class AudioGate {
  constructor(now = Date.now) { this.now = now; this.window = now(); this.bytes = 0; this.active = false; }
  start() { if (this.active) throw new Error('Already listening.'); this.active = true; }
  end() { if (!this.active) throw new Error('Not listening.'); this.active = false; }
  accept(buffer) {
    if (!this.active || !buffer.length || buffer.length > 6400 || buffer.length % 2) throw new Error('Invalid audio frame.');
    const now = this.now();
    if (now - this.window >= 1000) { this.window = now; this.bytes = 0; }
    this.bytes += buffer.length;
    if (this.bytes > 64000) throw new Error('Audio rate exceeded.');
  }
}
