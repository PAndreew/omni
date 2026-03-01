import { Router } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scoresDir = path.join(__dirname, '..', 'public', 'scores');

router.post('/scoreboard', async (req, res) => {
  try {
    await mkdir(scoresDir, { recursive: true });
    const payload = req.body || {};
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `zatacka-score-${stamp}.json`;
    const filePath = path.join(scoresDir, filename);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, url: `${req.protocol}://${req.get('host')}/scores/${filename}` });
  } catch (err) {
    res.status(500).json({ error: 'failed to save scoreboard' });
  }
});

export default router;
