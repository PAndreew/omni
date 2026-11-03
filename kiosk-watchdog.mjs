// Independent process: a frozen renderer cannot service its own watchdog.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function probeKiosk({ port = 9223, timeout = 5000 } = {}) {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
  if (!response.ok) throw new Error('Kiosk debugger unavailable.');
  const pages = await response.json();
  const page = pages.find(page => page.type === 'page' && /^http:\/\/localhost:3001\/?(?:[?#].*)?$/.test(page.url));
  if (!page?.webSocketDebuggerUrl) throw new Error('Kiosk page missing.');
  const value = await new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Renderer did not respond.')); }, timeout);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '({ age: Date.now() - (window.__omniClockHeartbeat || 0), visible: document.visibilityState })', returnByValue: true } }));
    socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('Renderer probe failed.')); };
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error || !message.result?.result?.value) reject(new Error('Invalid renderer heartbeat.'));
      else resolve(message.result.result.value);
    };
  });
  if (!Number.isFinite(value.age) || value.age > 90000) throw new Error('Kiosk clock heartbeat is stale.');
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pid = Number(process.argv[2]);
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Chromium PID is required.');
  await new Promise(resolve => setTimeout(resolve, 120000));
  let failures = 0;
  for (;;) {
    try { process.kill(pid, 0); } catch { break; }
    try { await probeKiosk(); failures = 0; }
    catch (error) {
      failures++;
      console.error(`[Kiosk watchdog] ${error.message} (${failures}/2)`);
      if (failures >= 2) {
        console.error('[Kiosk watchdog] Restarting frozen Chromium via the kiosk service.');
        process.kill(pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 5000));
        try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}
