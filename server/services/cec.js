/**
 * CEC Bridge — translates HDMI-CEC key events to socket events.
 * Requires cec-client (part of libcec) to be installed:
 *   sudo apt install cec-utils
 *
 * Run with: bun services/cec.js
 * Or this module auto-starts when imported if cec-client is found.
 */
import { spawn } from 'child_process';
import { execSync } from 'child_process';

let io = null;

const KEY_MAP = {
  'select':       'cec:select',
  'up':           'cec:up',
  'down':         'cec:down',
  'left':         'cec:left',
  'right':        'cec:right',
  'play':         'cec:play',
  'pause':        'cec:pause',
  'stop':         'cec:stop',
  'fast forward': 'cec:next',
  'rewind':       'cec:prev',
  'exit':         'cec:back',
};

export function startCEC(socketIo) {
  io = socketIo;

  let cecAvailable = false;
  try {
    execSync('which cec-client', { stdio: 'ignore' });
    cecAvailable = true;
  } catch {
    console.log('[CEC] cec-client not found — remote control disabled.');
    console.log('[CEC] Install with: sudo apt install cec-utils');
    return;
  }

  console.log('[CEC] Starting cec-client listener...');
  const proc = spawn('cec-client', ['-t', 'p', '-d', '8'], { stdio: ['ignore', 'pipe', 'ignore'] });

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/key pressed:\s+([a-z ]+)\s*\(/i);
      if (match) {
        const key = match[1].trim().toLowerCase();
        const event = KEY_MAP[key];
        if (event && io) {
          console.log(`[CEC] ${key} → ${event}`);
          io.emit(event, {});
        }
      }
    }
  });

  proc.on('exit', (code) => {
    console.log(`[CEC] cec-client exited (${code}), restarting in 5s...`);
    setTimeout(() => startCEC(io), 5000);
  });
}
