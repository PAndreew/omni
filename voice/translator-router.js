import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'translator');
export function translatorRouter(stateDir) {
  const router = express.Router();
  const data = path.join(stateDir, 'translations');
  let active = 0;
  const ready = (async () => {
    await fs.mkdir(data, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(data)) {
      const jobPath = path.join(data, entry, 'job.json');
      try {
        const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
        if (['queued', 'running'].includes(job.status)) {
          job.status = 'failed'; job.error = 'Translator service restarted. Please upload again.';
          await fs.writeFile(jobPath, JSON.stringify(job), { mode: 0o600 });
        }
      } catch { /* Ignore incomplete or unrelated directories. */ }
    }
  })();
  router.use(async (_req, res, next) => { try { await ready; next(); } catch { res.status(503).json({ error: 'Translation storage unavailable.' }); } });
  router.post('/', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
    if (active >= 2) return res.status(429).json({ error: 'Translator busy. Try again shortly.' });
    const name = String(req.headers['x-filename'] || '').slice(0, 240);
    const format = name.toLowerCase().endsWith('.docx') ? 'docx' : name.toLowerCase().endsWith('.pdf') ? 'pdf' : null;
    const targetLanguage = String(req.headers['x-target-language'] || '').trim();
    const sourceLanguage = String(req.headers['x-source-language'] || '').trim();
    const bytes = req.body;
    if (!format || !targetLanguage || targetLanguage.length > 80 || sourceLanguage.length > 80 || !Buffer.isBuffer(bytes) || !bytes.length || (format === 'pdf' ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0x50 || bytes[1] !== 0x4b)) return res.status(400).json({ error: 'Choose a valid DOCX or text-based PDF and target language.' });
    active++;
    try {
      const id = randomUUID(); const directory = path.join(data, id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const job = { id, originalName: name, format, targetLanguage, sourceLanguage, status: 'queued', progress: 'Starting translator' };
      await fs.writeFile(path.join(directory, `input.${format}`), bytes, { mode: 0o600 });
      await fs.writeFile(path.join(directory, 'job.json'), JSON.stringify(job), { mode: 0o600 });
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'worker.ts'), directory], { cwd: root, env: { ...process.env, OMNI_TRANSLATOR_ROOT: root }, stdio: ['ignore', 'ignore', 'inherit'] });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
      timeout.unref();
      let released = false;
      const finish = async (code) => { if (released) return; released = true; clearTimeout(timeout); active--; if (code !== 0) { job.status = 'failed'; job.error = 'Translation worker stopped.'; await fs.writeFile(path.join(directory, 'job.json'), JSON.stringify(job), { mode: 0o600 }); } };
      child.once('error', () => { void finish(1); }); child.once('exit', code => { void finish(code); });
      res.status(202).json(job);
    } catch { active--; res.status(500).json({ error: 'Could not start translation.' }); }
  });
  router.get('/:id/:download?', async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params.id) || (req.params.download && req.params.download !== 'download')) return res.sendStatus(404);
    try {
      const directory = path.join(data, req.params.id);
      const job = JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8'));
      res.setHeader('Cache-Control', 'no-store');
      if (!req.params.download) return res.json(job);
      if (job.status !== 'succeeded') return res.status(409).json({ error: 'Translation not ready.' });
      res.download(path.join(directory, `translated.${job.format}`), `translated.${job.format}`);
    } catch { res.sendStatus(404); }
  });
  return router;
}
