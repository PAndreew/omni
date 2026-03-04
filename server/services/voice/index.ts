// ─── Voice Pipeline Setup ─────────────────────────────────────────────────────

import type { Server as SocketIOServer } from 'socket.io';
import { DeepgramService } from './deepgram.js';
import { ChirpService } from './chirp.js';
import { VoiceAgent } from './agent.js';

export function setupVoice(io: SocketIOServer): void {
  const dgKey = process.env.DEEPGRAM_API_KEY;

  if (!dgKey) {
    console.warn('[Voice] DEEPGRAM_API_KEY not set — omni voice mode disabled');
    return;
  }

  const dg    = new DeepgramService(dgKey);
  const chirp = new ChirpService();
  const agent = new VoiceAgent(io, dg, chirp);

  io.on('connection', (socket) => {
    socket.on('voice:start', () => {
      console.log(`[Voice] voice:start from ${socket.id}`);
      agent.dispatch({ type: 'AUDIO_START', socketId: socket.id });
    });

    socket.on('voice:audio', (chunk: ArrayBuffer | Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      agent.dispatch({ type: 'AUDIO_CHUNK', socketId: socket.id, chunk: buf });
    });

    socket.on('voice:stop', () => {
      console.log(`[Voice] voice:stop from ${socket.id}`);
      agent.dispatch({ type: 'AUDIO_STOP', socketId: socket.id });
    });

    // Client confirms TTS finished playing — now safe to start the follow-up listen window
    socket.on('voice:tts_played', () => {
      agent.dispatch({ type: 'TTS_DONE', socketId: socket.id });
    });

    socket.on('disconnect', () => {
      agent.dispatch({ type: 'DISCONNECT', socketId: socket.id });
    });
  });

  console.log('[Voice] Pipeline ready (Deepgram + Pi Agent + Chirp)');
}
