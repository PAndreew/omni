import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { spotifySearch, spotifyPlayTrack } from '../services/spotify.js';

const router = Router();

const SCOPES = 'user-read-playback-state user-modify-playback-state';

// In-memory CSRF state store (expires after 10 min)
const pendingStates = new Set();

function getClientCreds() {
  const clientId = db.prepare("SELECT value FROM settings WHERE key='spotify_client_id'").get()?.value;
  const clientSecret = db.prepare("SELECT value FROM settings WHERE key='spotify_client_secret'").get()?.value;
  return { clientId, clientSecret };
}

function getRedirectUri() {
  return db.prepare("SELECT value FROM settings WHERE key='spotify_redirect_uri'").get()?.value || '';
}

// ── Step 1: start OAuth flow ──────────────────────────────────────────────
router.get('/auth', (req, res) => {
  const { clientId } = getClientCreds();
  const redirectUri = getRedirectUri();

  if (!clientId) {
    return res.status(400).send('<h2>Spotify Client ID not set</h2><p>Go to Settings → Spotify, save credentials first.</p>');
  }
  if (!redirectUri) {
    return res.status(400).send('<h2>Redirect URI not set</h2><p>Go to Settings → Spotify and set the Redirect URI.</p>');
  }

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.add(state);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// ── Step 2: Spotify redirects back here ──────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`<h2>Spotify auth error</h2><p>${error}</p><a href="/">← Back</a>`);
  }
  if (!pendingStates.has(state)) {
    return res.status(400).send('<h2>Invalid state</h2><p>Session expired or CSRF mismatch. <a href="/api/spotify/auth">Try again</a></p>');
  }
  pendingStates.delete(state);

  const { clientId, clientSecret } = getClientCreds();
  if (!clientId || !clientSecret) {
    return res.status(400).send('<h2>Missing credentials</h2><p>Client ID or Secret not saved. Go back to Settings.</p>');
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      console.error('[Spotify] Token exchange failed:', data);
      return res.status(400).send(`<h2>Token exchange failed</h2><pre>${JSON.stringify(data, null, 2)}</pre><a href="/">← Back</a>`);
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('spotify_refresh_token', ?)").run(data.refresh_token);
    console.log('[Spotify] OAuth complete — refresh token saved');

    res.redirect('/?spotify=connected');
  } catch (err) {
    console.error('[Spotify] Callback error:', err);
    res.status(500).send('<h2>Server error</h2><p>Check server logs.</p>');
  }
});

// ── Search ────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { q } = req.query;
  const results = await spotifySearch(q);
  res.json(results);
});

// ── Play track by URI ────────────────────────────────────────────────────
router.post('/play', async (req, res) => {
  const { uri } = req.body;
  const ok = await spotifyPlayTrack(uri);
  res.json({ ok });
});

export default router;
