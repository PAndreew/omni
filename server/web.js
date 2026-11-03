// Replaceable web slot: no SQLite, PTYs, sockets or background workers.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true, role: 'web' }));
app.use(express.static(path.join(root, 'public')));
app.use(express.static(path.join(root, '../client/dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, '../client/dist/index.html')));
app.listen(Number(process.env.PORT || 3001), '0.0.0.0');
