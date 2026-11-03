import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export class WakeDetector {
  constructor({ stateDir, model = path.join(stateDir, 'wake-model'), python = path.join(root, 'wake/.venv/bin/python'), enabled = false, source = '@DEFAULT_SOURCE@', spawnImpl = spawn }) {
    this.settings = path.join(stateDir, 'wake-settings.json');
    this.model = model; this.python = python; this.source = source; this.spawn = spawnImpl;
    this.available = existsSync(python) && existsSync(path.join(model, 'beezy-keywords.txt'));
    try { enabled = JSON.parse(readFileSync(this.settings, 'utf8')).enabled === true; } catch { /* First install uses explicit configured consent. */ }
    this.enabled = enabled; this.ready = false; this.sequence = 0; this.at = 0; this.claimed = 0;
    this.canWake = () => true;
  }
  status() { return { available: this.available, enabled: this.enabled, ready: this.ready, sequence: this.sequence, at: this.at, phrase: 'hé zumi' }; }
  start() {
    if (!this.available || !this.enabled || this.child) return;
    const child = this.spawn(this.python, ['-u', path.join(root, 'wake/detect.py'), '--model', this.model, '--source', this.source], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' } });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 1024 || this.child !== child) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'ready') this.ready = true;
        if (event.type === 'wake') this.detect();
      } catch { /* Ignore non-event diagnostics. */ }
    });
    child.stderr.on('data', () => {}); // No audio or transcripts are retained.
    const exited = () => {
      if (this.child !== child) return;
      lines.close(); this.child = null; this.ready = false;
      if (this.enabled) { console.warn('[Wake] Detector stopped; retrying in 5 seconds.'); this.retry = setTimeout(() => this.start(), 5000); this.retry.unref(); }
    };
    child.once('error', exited); child.once('exit', exited);
  }
  detect() {
    if (!this.enabled || !this.ready || !this.canWake() || Date.now() - this.at < 8000) return;
    this.sequence++; this.at = Date.now();
  }
  claim(sequence) {
    if (sequence !== this.sequence || this.claimed === sequence || Date.now() - this.at > 5000 || !this.enabled || !this.canWake()) return false;
    this.claimed = sequence; return true;
  }
  setEnabled(enabled) {
    if (enabled && !this.available) throw new Error('Wake detector is not installed.');
    this.enabled = enabled;
    writeFileSync(this.settings, JSON.stringify({ enabled }), { mode: 0o600 });
    if (enabled) this.start(); else this.stop();
  }
  stop() {
    clearTimeout(this.retry);
    const child = this.child; this.child = null; this.ready = false;
    if (child) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
  }
}
