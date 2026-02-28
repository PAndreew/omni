import { Database } from 'bun:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'omniwall.db');

mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { create: true });

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS chores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assignee TEXT DEFAULT '',
    done INTEGER DEFAULT 0,
    due_date TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    all_day INTEGER DEFAULT 0,
    color TEXT DEFAULT '#7C3AED',
    source TEXT DEFAULT 'manual',
    owner TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS calendars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    owner TEXT DEFAULT '',
    color TEXT DEFAULT '#7C3AED',
    enabled INTEGER DEFAULT 1,
    last_synced TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS layout (
    id TEXT PRIMARY KEY,
    x INTEGER, y INTEGER,
    w INTEGER, h INTEGER
  );
`);

// Migration
try { db.exec("ALTER TABLE events ADD COLUMN uid TEXT"); }      catch {}
try { db.exec("ALTER TABLE events ADD COLUMN all_day INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE events ADD COLUMN owner TEXT DEFAULT ''"); }     catch {}

const defaults = {
  weather_lat:    process.env.WEATHER_LAT  || '47.4979',
  weather_lon:    process.env.WEATHER_LON  || '19.0402',
  weather_city:   process.env.WEATHER_CITY || 'Budapest',
  admin_password: 'omni1234',
  tts_voice:      '',
  tts_rate:       '1',
  tts_pitch:      '1',
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaults)) insertDefault.run(key, value);

export default db;
