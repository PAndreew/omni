import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const [input, target, output, source = ''] = process.argv.slice(2);
if (!input || !target || !output || path.extname(input).toLowerCase() !== path.extname(output).toLowerCase()) throw new Error('Usage: translate.mjs input.docx|pdf target-language output.docx|pdf [source-language]');
try { await fs.access(output); throw new Error('Output already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const bytes = await fs.readFile(input);
if (bytes.length > 20 * 1024 * 1024) throw new Error('File exceeds 20 MB');
const key = (await fs.readFile(path.join(os.homedir(), '.config/omni-gizi/access-key'), 'utf8')).trim();
const base = 'http://127.0.0.1:3002';
const headers = { Authorization: `Bearer ${key}`, Origin: base };
const r = await fetch(`${base}/gizi/translations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-Filename': path.basename(input).replace(/[^\x20-\x7e]/g, '_'), 'X-Target-Language': target, 'X-Source-Language': source }, body: bytes });
let job = await r.json(); if (!r.ok) throw new Error(job.error || 'Upload failed');
const deadline = Date.now() + 60 * 60 * 1000;
while (!['succeeded', 'failed'].includes(job.status)) {
  if (Date.now() > deadline) throw new Error(`Polling timeout; job ${job.id} may still be running`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const response = await fetch(`${base}/gizi/translations/${job.id}`, { headers });
  if (!response.ok) throw new Error('Cannot retrieve job');
  job = await response.json(); console.log(job.progress);
}
if (job.status !== 'succeeded') throw new Error(job.error || 'Translation failed');
const download = await fetch(`${base}/gizi/translations/${job.id}/download`, { headers });
if (!download.ok) throw new Error('Download failed');
await fs.writeFile(output, Buffer.from(await download.arrayBuffer()), { flag: 'wx', mode: 0o600 });
console.log(`Saved ${output}`);
