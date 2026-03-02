import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (settings.admin_password) settings.admin_password = '***';
  // Expose only whether a refresh token is saved, not the value
  settings.spotify_connected = !!settings.spotify_refresh_token;
  delete settings.spotify_refresh_token;
  res.json(settings);
});

router.patch('/', (req, res) => {
  const allowed = [
    'weather_lat', 'weather_lon', 'weather_city',
    'ical_url', 'tts_voice', 'tts_rate', 'tts_pitch',
    'spotify_refresh_token', 'spotify_client_id', 'spotify_client_secret', 'spotify_redirect_uri',
    'voice_language'
  ];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) stmt.run(key, String(value));
  }
  res.json({ ok: true });
});

router.post('/auth', (req, res) => {
  const { password } = req.body;
  const stored = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get()?.value;
  if (password === stored) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

export default router;
