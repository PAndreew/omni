import fs from 'node:fs/promises';
import path from 'node:path';
import { translateDocx } from './translate';
import { translatePdf } from './pdf';
const directory = process.argv[2];
const jobPath = path.join(directory, 'job.json');
const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
async function save() { await fs.writeFile(jobPath + '.tmp', JSON.stringify(job), { mode: 0o600 }); await fs.rename(jobPath + '.tmp', jobPath); }
let writes = Promise.resolve();
try {
  job.status = 'running'; await save();
  const options = { inputPath: path.join(directory, `input.${job.format}`), outputPath: path.join(directory, `translated.${job.format}`), workingDirectory: directory, targetLanguage: job.targetLanguage, sourceLanguage: job.sourceLanguage || undefined, onProgress: (message: string) => { writes = writes.then(async () => { job.progress = message; await save(); }); } };
  const result = job.format === 'pdf' ? await translatePdf(options) : await translateDocx(options);
  await writes; job.status = 'succeeded'; job.chunksTranslated = result.chunksTranslated; job.progress = 'Ready to download';
} catch (error) { await writes; job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); }
await save();
