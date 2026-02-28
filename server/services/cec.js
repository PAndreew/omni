/**
 * CEC Bridge — translates HDMI-CEC key events to socket events.
 * Requires cec-client (part of libcec) to be installed:
 *   sudo apt install cec-utils
 *
 * Uses /dev/cec1 — the HDMI output adapter on Raspberry Pi.
 * /dev/cec0 is the internal (DSI/display) adapter; /dev/cec1 is the TV-facing one.
 */
import { spawn } from 'child_process';
import { execSync } from 'child_process';

let io = null;

// Maps libcec key-name strings → socket event names.
// Key names come from libcec's CECTypeUtils::UserControlCodeToString().
const KEY_MAP = {
  'select':       'cec:select',
  'up':           'cec:up',
  'down':         'cec:down',
  'left':         'cec:left',
  'right':        'cec:right',
  'enter':        'cec:select',   // some TVs send "enter" instead of "select"
  'play':         'cec:play',
  'pause':        'cec:pause',
  'stop':         'cec:stop',
  'fast forward': 'cec:next',
  'fast reverse': 'cec:prev',     // libcec 6.x uses "fast reverse" not "rewind"
  'rewind':       'cec:prev',     // keep for older libcec builds
  'backward':     'cec:prev',
  'forward':      'cec:next',
  'exit':         'cec:back',
};

// Preferred adapter: /dev/cec1 is the HDMI-out (TV-facing) port on RPi.
// Falls back to auto-detection if not present.
const CEC_ADAPTER = (() => {
  try { execSync('test -e /dev/cec1', { stdio: 'ignore' }); return '/dev/cec1'; } catch {}
  try { execSync('test -e /dev/cec0', { stdio: 'ignore' }); return '/dev/cec0'; } catch {}
  return null;
})();

export function startCEC(socketIo) {
  io = socketIo;

  try {
    execSync('which cec-client', { stdio: 'ignore' });
  } catch {
    console.log('[CEC] cec-client not found — remote control disabled.');
    console.log('[CEC] Install with: sudo apt install cec-utils');
    return;
  }

  if (!CEC_ADAPTER) {
    console.log('[CEC] No /dev/cec device found — remote control disabled.');
    return;
  }

  console.log(`[CEC] Starting cec-client on ${CEC_ADAPTER}...`);

  // -t p  = register as "playback device" (receives remote key events)
  // -d 1  = NOTICE log level — enough to see "key pressed:" lines, without debug flood
  const proc = spawn(
    'cec-client',
    [CEC_ADAPTER, '-t', 'p', '-d', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'] },   // pipe both stdout and stderr
  );

  const handleChunk = (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      // cec-client emits: "key pressed: <name> (<hex>)"
      // Example: "key pressed: up (1)" or "NOTICE: [...] key pressed: select (0)"
      const match = line.match(/key pressed:\s+([a-z][a-z ]*?)\s*\(/i);
      if (match) {
        const key = match[1].trim().toLowerCase();
        const event = KEY_MAP[key];
        if (event && io) {
          console.log(`[CEC] ${key} → ${event}`);
          io.emit(event, {});
        } else if (!event) {
          console.log(`[CEC] unmapped key: "${key}" — add to KEY_MAP if needed`);
        }
      }
    }
  };

  proc.stdout.on('data', handleChunk);
  proc.stderr.on('data', handleChunk);  // some libcec builds write to stderr

  proc.on('exit', (code) => {
    console.log(`[CEC] cec-client exited (${code}), restarting in 5s...`);
    setTimeout(() => startCEC(io), 5000);
  });
}
