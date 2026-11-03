import express from 'express';
import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_UPLOAD = 200 * 1024 * 1024;
const roots = ['Downloads', 'Documents/Uploads', 'Pictures', 'Music', 'Videos'];
const markers = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
const blocked = new Set(['node_modules', 'venv', 'env', '__pycache__']);
function safeParts(value) {
  return typeof value === 'string' && value.length <= 512 && value.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.') && !blocked.has(p) && !/[\\\x00-\x1f\x7f]/.test(p));
}
export async function safeFolder(home, folder) {
  const allowedRoot = roots.find(root => folder === root || (typeof folder === 'string' && folder.startsWith(`${root}/`)));
  if (!safeParts(folder) || !allowedRoot) throw new Error('Choose a permitted upload folder.');
  const base = await fs.realpath(home);
  let current = base, depth = 0;
  for (const part of folder.split('/')) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Symlink and non-directory destinations are prohibited.');
    // Inspect every ancestor for symlinks, but source markers only inside
    // the explicitly allowed root (Documents/Uploads is a dedicated root).
    depth++;
    if (depth < allowedRoot.split('/').length) continue;
    for (const marker of markers) {
      try { await fs.lstat(path.join(current, marker)); throw new Error('Application/source folders are prohibited.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return current;
}
async function pinFolder(home, folder, directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    // Revalidate after opening; pinning prevents later rename/symlink swaps
    // from redirecting a write into a different directory.
    if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== directory || await safeFolder(home, folder) !== directory) throw new Error('Destination changed.');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
export function fileUploadRouter({ home = homedir(), maxBytes = MAX_UPLOAD } = {}) {
  const router = express.Router();
  let active = 0;
  const ready = (async () => {
    // Never create directories through symlinks, even during initialization.
    for (const name of ['Downloads', 'Documents', 'Pictures', 'Music', 'Videos']) {
      const target = path.join(home, name);
      try { await fs.mkdir(target, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      if (name === 'Documents') {
        try { await fs.mkdir(path.join(target, 'Uploads'), { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    }
  })();
  router.use(async (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await ready; next(); } catch { res.status(503).json({ error: 'Upload storage unavailable.' }); }
  });
  router.get('/folders', async (req, res) => {
    try {
      if (req.query.folder === undefined) {
        const folders = [];
        for (const folder of roots) { try { await safeFolder(home, folder); folders.push(folder); } catch { /* Unsafe or missing root is not offered. */ } }
        return res.json({ folders, maxBytes });
      }
      const directory = await safeFolder(home, req.query.folder);
      const folders = [];
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const folder = `${req.query.folder}/${entry.name}`;
        try { await safeFolder(home, folder); folders.push(folder); } catch { /* Hide unsafe folders. */ }
        if (folders.length >= 200) break;
      }
      res.json({ folders, selected: req.query.folder, maxBytes });
    } catch { res.status(400).json({ error: 'Choose a permitted folder; system, hidden, application and symlink folders are blocked.' }); }
  });
  router.post('/folder', express.json({ limit: '1kb' }), async (req, res) => {
    let handle;
    try {
      const directory = await safeFolder(home, req.body.folder);
      const name = req.body.name;
      if (!safeParts(name) || name.includes('/') || name.length > 120) throw new Error('Invalid folder name.');
      handle = await pinFolder(home, req.body.folder, directory);
      await fs.mkdir(`/proc/self/fd/${handle.fd}/${name}`, { mode: 0o700 });
      res.status(201).json({ folder: `${req.body.folder}/${name}` });
    } catch { res.status(400).json({ error: 'Could not create folder. Choose a new, non-hidden folder name in an allowed destination.' }); }
    finally { await handle?.close(); }
  });
  router.post('/upload', async (req, res) => {
    if (active >= 2) return res.status(429).json({ error: 'Two uploads are already running. Try again shortly.' });
    active++;
    let directoryHandle, output, target, created = false;
    try {
      const directory = await safeFolder(home, req.query.folder);
      const name = req.query.name;
      if (!safeParts(name) || name.includes('/') || Buffer.byteLength(name) > 240) throw new Error('Choose a regular, non-hidden filename.');
      const length = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
        return res.status(413).json({ error: `Files must be at most ${Math.floor(maxBytes / 1024 / 1024)} MB with a known size.` });
      }
      const disk = await fs.statfs(directory);
      if (disk.bavail * disk.bsize < length + 256 * 1024 * 1024) return res.status(507).json({ error: 'Not enough free space. At least 256 MB must remain on the Pi.' });
      // Pin the directory inode. Never follow a final-file symlink or overwrite
      // an existing file. The browser cannot choose arbitrary absolute paths.
      directoryHandle = await pinFolder(home, req.query.folder, directory);
      target = `/proc/self/fd/${directoryHandle.fd}/${name}`;
      output = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      let bytes = 0;
      const guard = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes || bytes > length ? new Error('Upload size limit exceeded.') : null, chunk);
      } });
      const stream = createWriteStream(target, { fd: output.fd, autoClose: false });
      await pipeline(req, guard, stream);
      if (bytes !== length) throw new Error('Incomplete upload.');
      await output.sync();
      await output.close(); output = null;
      res.status(201).json({ name, folder: req.query.folder, bytes });
    } catch (error) {
      await output?.close().catch(() => {}); output = null;
      if (created) await fs.unlink(target).catch(() => {});
      if (!res.destroyed) res.status(error.code === 'EEXIST' ? 409 : 400).json({ error: error.code === 'EEXIST' ? 'A file with that name exists. Rename your upload; files are never overwritten.' : 'Upload rejected or interrupted. Choose an allowed folder and regular filename.' });
    } finally { await directoryHandle?.close(); active--; }
  });
  return router;
}
