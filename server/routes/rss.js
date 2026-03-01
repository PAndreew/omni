import express from 'express';
import db from '../db.js';

const router = express.Router();

// ── XML helpers ────────────────────────────────────────────────────────────────
// Extract text from a simple XML tag, handles CDATA and plain text.
function getTag(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>` +
    `|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );
  const m = re.exec(block);
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function parseRss(xml, feedName) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const pubDate = getTag(b, 'pubDate');
    items.push({
      feedName,
      title:       getTag(b, 'title'),
      link:        getTag(b, 'link'),
      description: getTag(b, 'description') || getTag(b, 'encoded'),
      pubDate,
      pubTs: pubDate ? new Date(pubDate).getTime() : 0,
    });
  }
  return items;
}

// ── Feed CRUD ──────────────────────────────────────────────────────────────────

// List all feeds
router.get('/feeds', (req, res) => {
  const feeds = db.prepare('SELECT * FROM rss_feeds ORDER BY added_at DESC').all();
  res.json(feeds);
});

// Add a feed
router.post('/feeds', (req, res) => {
  const { name, url } = req.body ?? {};
  if (!name?.trim() || !url?.trim())
    return res.status(400).json({ error: 'name and url required' });
  try {
    const r = db.prepare('INSERT INTO rss_feeds (name, url) VALUES (?, ?)').run(name.trim(), url.trim());
    res.json({ id: r.lastInsertRowid, name: name.trim(), url: url.trim(), enabled: 1 });
  } catch {
    res.status(409).json({ error: 'Feed URL already exists' });
  }
});

// Toggle enabled
router.patch('/feeds/:id', (req, res) => {
  const { enabled } = req.body ?? {};
  db.prepare('UPDATE rss_feeds SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Delete a feed
router.delete('/feeds/:id', (req, res) => {
  db.prepare('DELETE FROM rss_feeds WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Aggregated feed ────────────────────────────────────────────────────────────
// Fetches all enabled feeds in parallel, parses XML server-side, returns JSON.
router.get('/', async (req, res) => {
  try {
    const feeds = db.prepare('SELECT * FROM rss_feeds WHERE enabled = 1').all();
    if (!feeds.length) return res.json([]);

    const results = await Promise.allSettled(
      feeds.map(f =>
        fetch(f.url, { signal: AbortSignal.timeout(8000) })
          .then(r => r.text())
          .then(xml => parseRss(xml, f.name))
      )
    );

    const items = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .sort((a, b) => b.pubTs - a.pubTs)   // newest first
      .slice(0, 60);                         // cap at 60 items

    res.json(items);
  } catch (err) {
    console.error('[RSS] fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

export default router;
