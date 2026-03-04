// ─── Voice Pipeline Setup ─────────────────────────────────────────────────────

import type { Server as SocketIOServer } from 'socket.io';
import type Database from 'better-sqlite3';
import { DeepgramService } from './deepgram.js';
import { OpenRouterService } from './openrouter.js';
import { ChirpService } from './chirp.js';
import { buildTools } from './tools.js';
import { VoiceAgent } from './agent.js';

export function setupVoice(io: SocketIOServer, db: InstanceType<typeof Database>): void {
  const dgKey = process.env.DEEPGRAM_API_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;

  if (!dgKey || !orKey) {
    console.warn('[Voice] DEEPGRAM_API_KEY or OPENROUTER_API_KEY not set — omni voice mode disabled');
    return;
  }

  const dg    = new DeepgramService(dgKey);
  const or    = new OpenRouterService(
    orKey,
    process.env.OPENROUTER_SIMPLE_MODEL  || 'groq/llama-3.3-70b-versatile',
    process.env.OPENROUTER_MEDIUM_MODEL  || 'moonshotai/kimi-k2',
    process.env.OPENROUTER_COMPLEX_MODEL || 'anthropic/claude-sonnet-4-6',
  );
  const chirp = new ChirpService();
  const tools = buildTools(db as any);
  const agent = new VoiceAgent(io, dg, or, chirp, tools as any);

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

    // DISCONNECT is already handled by index.js — we also hook it here for cleanup
    socket.on('disconnect', () => {
      agent.dispatch({ type: 'DISCONNECT', socketId: socket.id });
    });
  });

  console.log('[Voice] Pipeline ready (Deepgram + OpenRouter + Chirp)');
}
