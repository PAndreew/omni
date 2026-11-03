import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoiceServer } from '../server.js';
import JSZip from 'jszip';

test('translator requires authentication, same origin, valid file and job IDs', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-translator-'));
  const service = createVoiceServer({ stateDir, accessKey: 'test-key', connect: async () => {} });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/gizi/translations/nope`)).status, 403);
    assert.equal((await fetch(`${base}/gizi/translations/nope`, { headers: { Authorization: 'Bearer test-key' } })).status, 404);
    assert.equal((await fetch(`${base}/gizi/translations`, { method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(`${base}/gizi/translations`, { method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: base, 'Content-Type': 'application/octet-stream', 'X-Filename': 'bad.pdf', 'X-Target-Language': 'Hungarian' }, body: 'not a PDF' })).status, 400);
    const zip = new JSZip();
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>');
    const upload = await fetch(`${base}/gizi/translations`, { method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: base, 'Content-Type': 'application/octet-stream', 'X-Filename': 'empty.docx', 'X-Target-Language': 'Hungarian' }, body: await zip.generateAsync({ type: 'nodebuffer' }) });
    assert.equal(upload.status, 202);
    let job = await upload.json();
    assert.equal((await fetch(`${base}/gizi/translations/${job.id}/download`, { headers: { Authorization: 'Bearer test-key' } })).status, 409);
    for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(job.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      job = await (await fetch(`${base}/gizi/translations/${job.id}`, { headers: { Authorization: 'Bearer test-key' } })).json();
    }
    assert.equal(job.status, 'succeeded', job.error);
    const download = await fetch(`${base}/gizi/translations/${job.id}/download`, { headers: { Authorization: 'Bearer test-key' } });
    assert.equal(download.status, 200);
    const translated = await JSZip.loadAsync(await download.arrayBuffer());
    assert.match(await translated.file('word/document.xml').async('string'), /<w:p\/>/);
  } finally { service.close(); await fs.rm(stateDir, { recursive: true, force: true }); }
});
