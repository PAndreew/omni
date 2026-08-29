import express from 'express';

const router = express.Router();

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const FEEDS = [
  { name: 'Nautilus', url: 'https://nautil.us/feed/' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'Hacker News', url: 'https://hnrss.org/newest' },
  { name: 'Techmeme', url: 'https://www.techmeme.com/feed.xml' },
];

let cache = null;
let cacheTime = 0;

function getTag(block, tag) {
  const expression = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>` +
    `|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  const match = expression.exec(block);
  return match ? (match[1] ?? match[2] ?? '').trim() : '';
}

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml, feedName) {
  const items = [];
  const itemExpression = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemExpression.exec(xml)) !== null) {
    const block = match[1];
    const pubDate = getTag(block, 'pubDate') || getTag(block, 'dc:date');
    const pubTs = Date.parse(pubDate);
    const title = decodeText(getTag(block, 'title'));
    if (!title || !Number.isFinite(pubTs)) continue;

    items.push({
      feedName,
      title,
      link: decodeText(getTag(block, 'link')),
      pubDate,
      pubTs,
    });
  }

  return items;
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function chooseTwo(groups) {
  const availableGroups = shuffled(groups.filter((group) => group.items.length > 0));
  const selected = availableGroups.slice(0, 2).map((group) => shuffled(group.items)[0]);

  if (selected.length < 2 && availableGroups[0]) {
    const unused = shuffled(availableGroups[0].items.filter((item) => item.link !== selected[0]?.link));
    if (unused[0]) selected.push(unused[0]);
  }

  return selected.slice(0, 2);
}

router.get('/feeds', (_req, res) => res.json(FEEDS));

router.get('/', async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cacheTime < CACHE_MS) return res.json(cache);

    const results = await Promise.allSettled(FEEDS.map(async (feed) => {
      const response = await fetch(feed.url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'OmniWall/1.0 RSS reader' },
      });
      if (!response.ok) throw new Error(`${feed.name}: HTTP ${response.status}`);
      return { ...feed, items: parseRss(await response.text(), feed.name) };
    }));

    const cutoff = now - FOUR_HOURS_MS;
    const groups = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => ({
        name: result.value.name,
        items: result.value.items.filter((item) => item.pubTs >= cutoff && item.pubTs <= now + 5 * 60 * 1000),
      }));

    cache = chooseTwo(groups);
    cacheTime = now;
    res.json(cache);
  } catch (error) {
    console.error('[RSS] fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch headlines' });
  }
});

export default router;
