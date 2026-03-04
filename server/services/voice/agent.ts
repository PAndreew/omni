// ─── VoiceAgent Orchestrator ──────────────────────────────────────────────────
// Dispatches events through the state machine and executes resulting actions.

import type { Server as SocketIOServer } from 'socket.io';
import type { VoiceSession, VoiceEvent, VoiceAction } from './types.js';
import { processEvent } from './state.js';
import type { DeepgramService } from './deepgram.js';
import type { OpenRouterService } from './openrouter.js';
import type { ChirpService } from './chirp.js';
import type { AgentTool } from './types.js';
import { processVoiceCommandSocket } from '../agent.js';

const GREETING = 'How can I help?';
const WAKE_TIMEOUT_MS = 10_000;

export class VoiceAgent {
  private sessions    = new Map<string, VoiceSession>();
  private wakeTimers  = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private io: SocketIOServer,
    private dg: DeepgramService,
    private or: OpenRouterService,
    private chirp: ChirpService,
    private tools: (AgentTool & { __execute: (args: any) => any })[],
  ) {}

  private getSocket(socketId: string) {
    return this.io.sockets.sockets.get(socketId);
  }

  private emit(socketId: string, event: string, data?: any) {
    const sock = this.getSocket(socketId);
    if (sock?.connected) sock.emit(event, data);
  }

  // ── Main dispatch ──────────────────────────────────────────────────────────

  dispatch(event: VoiceEvent): void {
    const { socketId } = event;

    // Handle AUDIO_START: create session
    if (event.type === 'AUDIO_START') {
      if (this.sessions.has(socketId)) return; // already active
      this.createSession(socketId);
      return;
    }

    // Handle AUDIO_CHUNK: forward to Deepgram
    if (event.type === 'AUDIO_CHUNK') {
      const session = this.sessions.get(socketId);
      if (session?.deepgramLiveClient) {
        this.dg.feedChunk(session.deepgramLiveClient, event.chunk);
      }
      return;
    }

    const session = this.sessions.get(socketId);
    if (!session) return;

    const { session: nextSession, actions } = processEvent(session, event);
    this.sessions.set(socketId, nextSession);

    this.executeActions(nextSession, actions);
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  private createSession(socketId: string): void {
    const session: VoiceSession = {
      socketId,
      state: 'IDLE',
      history: [],
      deepgramLiveClient: null,
      ttsAbortController: null,
      llmAbortController: null,
    };
    this.sessions.set(socketId, session);

    // Open Deepgram live connection
    const live = this.dg.openLiveSession({
      onTranscript: (text, isFinal) => {
        this.dispatch({ type: isFinal ? 'TRANSCRIPT_FINAL' : 'TRANSCRIPT_INTERIM', socketId, text });
      },
      onSpeechStarted: () => {
        this.dispatch({ type: 'SPEECH_STARTED', socketId });
      },
      onError: (err) => {
        console.error(`[VoiceAgent] Deepgram error for ${socketId}:`, err);
      },
      onClose: () => {
        console.log(`[VoiceAgent] Deepgram closed for ${socketId}`);
      },
    });

    // Update session with live client and set state to LISTENING
    const updated = { ...session, deepgramLiveClient: live, state: 'LISTENING' as const };
    this.sessions.set(socketId, updated);
    console.log(`[VoiceAgent] Session created for ${socketId}`);
    this.emit(socketId, 'voice:status', { text: 'Listening…' });
  }

  private destroySession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;
    this.clearWakeTimer(socketId);
    // Abort any in-flight operations
    session.ttsAbortController?.abort();
    session.llmAbortController?.abort();
    // Close Deepgram
    if (session.deepgramLiveClient) {
      this.dg.closeSession(session.deepgramLiveClient);
    }
    this.sessions.delete(socketId);
    console.log(`[VoiceAgent] Session destroyed for ${socketId}`);
  }

  // ── Action executor ────────────────────────────────────────────────────────

  private executeActions(session: VoiceSession, actions: VoiceAction[]): void {
    const { socketId } = session;

    for (const action of actions) {
      switch (action.type) {

        case 'EMIT_TRANSCRIPT':
          this.emit(socketId, 'voice:transcript', { text: action.text, isFinal: action.isFinal });
          break;

        case 'EMIT_STREAM':
          this.emit(socketId, 'voice:stream', { delta: action.delta });
          break;

        case 'EMIT_STATUS':
          this.emit(socketId, 'voice:status', { text: action.text });
          break;

        case 'GREET_USER':
          this.emit(socketId, 'voice:awake');
          this.emit(socketId, 'voice:status', { text: 'Say your command…' });
          this.launchGreetingTTS(socketId);
          break;

        case 'START_WAKE_TIMEOUT':
          this.startWakeTimer(socketId);
          break;

        case 'CANCEL_WAKE_TIMEOUT':
          this.clearWakeTimer(socketId);
          break;

        case 'EMIT_DONE':
          this.emit(socketId, 'voice:done', { text: action.text });
          // TTS is launched after EMIT_DONE
          this.launchTTS(socketId, action.text);
          break;

        case 'EMIT_INTERRUPT':
          this.emit(socketId, 'voice:interrupt');
          this.emit(socketId, 'voice:status', { text: 'Listening…' });
          break;

        case 'ADD_TO_HISTORY': {
          const s = this.sessions.get(socketId);
          if (s) {
            s.history.push({ role: action.role, content: action.text });
            // Cap history at 20 turns
            if (s.history.length > 20) s.history.splice(0, s.history.length - 20);
          }
          break;
        }

        case 'START_LLM':
          this.launchLLM(socketId, action.text);
          break;

        case 'ABORT_TTS': {
          const s = this.sessions.get(socketId);
          s?.ttsAbortController?.abort();
          break;
        }

        case 'ABORT_LLM': {
          const s = this.sessions.get(socketId);
          s?.llmAbortController?.abort();
          break;
        }

        case 'CLEANUP':
          this.destroySession(socketId);
          break;
      }
    }
  }

  // ── Wake word greeting ─────────────────────────────────────────────────────

  private launchGreetingTTS(socketId: string): void {
    const ctrl = new AbortController();
    this.chirp.synthesizeStreaming(
      GREETING,
      ctrl.signal,
      (audio, isLast) => {
        if (ctrl.signal.aborted) return;
        this.emit(socketId, 'voice:audio_chunk', audio);
        if (isLast) this.emit(socketId, 'voice:audio_end');
      },
    ).catch(() => {});
  }

  private startWakeTimer(socketId: string): void {
    this.clearWakeTimer(socketId);
    const t = setTimeout(() => {
      this.wakeTimers.delete(socketId);
      this.dispatch({ type: 'WAKE_TIMEOUT', socketId });
    }, WAKE_TIMEOUT_MS);
    this.wakeTimers.set(socketId, t);
  }

  private clearWakeTimer(socketId: string): void {
    const t = this.wakeTimers.get(socketId);
    if (t !== undefined) { clearTimeout(t); this.wakeTimers.delete(socketId); }
  }

  // ── LLM streaming ──────────────────────────────────────────────────────────

  private launchLLM(socketId: string, text: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    const complexity = this.or.classifyComplexity(text);

    // Complex tasks → delegate to pi agent
    if (complexity === 'complex') {
      this.launchPiAgent(socketId, text);
      return;
    }

    const ctrl = new AbortController();
    session.llmAbortController = ctrl;
    this.sessions.set(socketId, session);

    this.emit(socketId, 'voice:status', { text: 'Thinking…' });

    this.or.streamResponse(
      text,
      session.history,
      this.tools,
      (status) => {
        this.emit(socketId, 'voice:status', { text: status });
      },
      (delta) => {
        this.dispatch({ type: 'LLM_DELTA', socketId, delta });
      },
      (fullText) => {
        this.dispatch({ type: 'LLM_DONE', socketId, text: fullText });
      },
      ctrl.signal,
    ).catch(err => {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      console.error('[VoiceAgent] LLM error:', err);
      this.emit(socketId, 'voice:status', { text: 'Something went wrong.' });
    });
  }

  private launchPiAgent(socketId: string, text: string): void {
    console.log(`[VoiceAgent] Delegating to pi agent: "${text}"`);
    this.emit(socketId, 'voice:status', { text: 'Working on it…' });

    processVoiceCommandSocket(text, (event: string, data: any) => {
      if (event === 'agent:status') {
        this.emit(socketId, 'voice:status', { text: data.text });
      } else if (event === 'agent:done') {
        this.dispatch({ type: 'LLM_DONE', socketId, text: data.text || 'Done.' });
      } else if (event === 'agent:error') {
        this.dispatch({ type: 'LLM_DONE', socketId, text: data.text || 'Something went wrong.' });
      }
    }).catch((err: any) => {
      console.error('[VoiceAgent] Pi agent error:', err);
      this.dispatch({ type: 'LLM_DONE', socketId, text: 'The agent encountered an error.' });
    });
  }

  // ── TTS synthesis + streaming ──────────────────────────────────────────────

  private launchTTS(socketId: string, text: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    const ctrl = new AbortController();
    session.ttsAbortController = ctrl;
    this.sessions.set(socketId, session);

    this.chirp.synthesizeStreaming(
      text,
      ctrl.signal,
      (audio, isLast) => {
        if (ctrl.signal.aborted) return;
        this.emit(socketId, 'voice:audio_chunk', audio);
        if (isLast) {
          this.emit(socketId, 'voice:audio_end');
          this.dispatch({ type: 'TTS_DONE', socketId });
        }
      },
    ).catch(err => {
      if (err?.name === 'AbortError' || err?.message === 'aborted' || ctrl.signal.aborted) return;
      console.error('[VoiceAgent] TTS error:', err);
      // Still transition to LISTENING even if TTS fails
      this.dispatch({ type: 'TTS_DONE', socketId });
    });
  }
}
