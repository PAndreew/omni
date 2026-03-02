import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT    = path.join(__dirname, '..', 'whisper_server.py');

let proc = null;

export function startWhisper() {
  proc = spawn('python3', [SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stdout.on('data', d => process.stdout.write(d));
  proc.stderr.on('data', d => process.stderr.write(d));

  proc.on('exit', (code, signal) => {
    console.log(`[Whisper] process exited (code=${code} signal=${signal}) — restarting in 3s`);
    setTimeout(startWhisper, 3000);
  });

  console.log(`[Whisper] Started whisper_server.py (pid=${proc.pid})`);
}
