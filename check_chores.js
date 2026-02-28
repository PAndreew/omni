import { Database } from 'bun:sqlite';
import path from 'path';

const dbPath = '/home/pi/Documents/omni/server/data/omniwall.db';
const db = new Database(dbPath);

const chores = db.prepare('SELECT * FROM chores').all();
console.log(JSON.stringify(chores, null, 2));
