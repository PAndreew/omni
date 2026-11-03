import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { probeKiosk } from '../../kiosk-watchdog.mjs';

test('external watchdog detects stale clocks and unresponsive renderers', async t => {
  let age = 500, respond = true;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ type: 'page', url: 'http://localhost:3001/', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}` }]));
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', socket => socket.on('message', message => {
    if (respond) socket.send(JSON.stringify({ id: JSON.parse(message).id, result: { result: { value: { age, visible: 'visible' } } } }));
  }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const socket of wss.clients) socket.terminate(); wss.close(); server.close(); });
  const options = { port: server.address().port, timeout: 500 };
  assert.equal((await probeKiosk(options)).age, 500);
  age = 120000;
  await assert.rejects(probeKiosk(options), /heartbeat is stale/);
  respond = false;
  await assert.rejects(probeKiosk(options), /Renderer did not respond/);
});
