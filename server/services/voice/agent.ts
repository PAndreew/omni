// ─── VoiceAgent Orchestrator ──────────────────────────────────────────────────
// Dispatches events through the state machine and executes resulting actions.

import type { Server as SocketIOServer } from 'socket.io';
import type { VoiceSession, VoiceEvent, VoiceAction } from './types.js';
import { processEvent } from './state.js';
import type { DeepgramService } from './deepgram.js';
import type { ChirpService } from './chirp.js';
import { processVoiceCommandSocket, isComplexTask, abortAndRecreateSession, resumeComplexSession } from '../agent.js';

const GREETING = 'How can I help?';
const WAKE_TIMEOUT_MS = 10_000;

export class VoiceAgent {
  private sessions        = new Map<string, VoiceSession>();
  private wakeTimers      = new Map<string, ReturnType<typeof setTimeout>>();
  private thinkingTimers  = new Map<string, ReturnType<typeof setTimeout>>();
  private piAbortFns      = new Map<string, () => void>();

  constructor(
    private io: SocketIOServer,
    private dg: DeepgramService,
    private chirp: ChirpService,
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
      ttsActive: false,
    };
    this.sessions.set(socketId, session);

    // Open Deepgram live connection
    const live = this.dg.openLiveSession({
      onTranscript: (text, isFinal) => {
        if (isFinal) console.log(`[VoiceAgent] Transcript (${socketId.slice(0,6)}): "${text}"`);
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
    this.clearThinkingTimer(socketId);
    // Abort any in-flight operations
    session.ttsAbortController?.abort();
    this.piAbortFns.get(socketId)?.();
    this.piAbortFns.delete(socketId);
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

        case 'START_THINKING_TIMEOUT':
          this.startThinkingTimer(socketId);
          break;

        case 'CANCEL_THINKING_TIMEOUT':
          this.clearThinkingTimer(socketId);
          break;

        case 'EMIT_DONE':
          this.emit(socketId, 'voice:done', { text: action.text });
          // TTS is launched after EMIT_DONE
          this.launchTTS(socketId, action.text);
          break;

        case 'EMIT_INTERRUPT':
          this.emit(socketId, 'voice:interrupt');
          this.emit(socketId, 'voice:status', { text: 'Say your command…' });
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
          this.launchPiAgent(socketId, action.text);
          break;

        case 'ABORT_TTS': {
          const s = this.sessions.get(socketId);
          if (s) { s.ttsActive = false; this.sessions.set(socketId, s); }
          s?.ttsAbortController?.abort();
          break;
        }

        case 'ABORT_LLM': {
          this.clearThinkingTimer(socketId);
          const abortFn = this.piAbortFns.get(socketId);
          this.piAbortFns.delete(socketId);
          if (abortFn) {
            abortFn();
            // Recreate session so future prompts work (abort corrupts session state)
            abortAndRecreateSession().catch((e: any) =>
              console.error('[VoiceAgent] Session recreate failed:', e.message));
          }
          break;
        }

        case 'RESUME_SESSION':
          this.launchResumeSession(socketId);
          break;

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

  private startThinkingTimer(socketId: string): void {
    this.clearThinkingTimer(socketId);
    const t = setTimeout(() => {
      this.thinkingTimers.delete(socketId);
      this.dispatch({ type: 'THINKING_TIMEOUT', socketId });
    }, 30_000);
    this.thinkingTimers.set(socketId, t);
  }

  private clearThinkingTimer(socketId: string): void {
    const t = this.thinkingTimers.get(socketId);
    if (t !== undefined) { clearTimeout(t); this.thinkingTimers.delete(socketId); }
  }

  private launchResumeSession(socketId: string): void {
    processVoiceCommandSocket('/resume', (event: string, data: any) => {
      if (event === 'agent:status') {
        this.emit(socketId, 'voice:status', { text: data.text });
      } else if (event === 'agent:done') {
        this.piAbortFns.delete(socketId);
        this.clearThinkingTimer(socketId);
        this.dispatch({ type: 'LLM_DONE', socketId, text: data.text || 'Session resumed.' });
      } else if (event === 'agent:error') {
        this.piAbortFns.delete(socketId);
        this.clearThinkingTimer(socketId);
        this.dispatch({ type: 'LLM_DONE', socketId, text: 'Could not resume session.' });
      }
    }, true, (abortFn: () => void) => {
      this.piAbortFns.set(socketId, abortFn);
    }).catch((err: any) => {
      console.error('[VoiceAgent] Resume error:', err);
      this.dispatch({ type: 'LLM_DONE', socketId, text: 'Could not resume session.' });
    });
  }

  // ── Pi agent ───────────────────────────────────────────────────────────────

  private launchPiAgent(socketId: string, text: string): void {
    const complex = isComplexTask(text);
    console.log(`[VoiceAgent] → pi agent (${complex ? 'sonnet' : 'kimi'}): "${text}"`);
    this.emit(socketId, 'voice:status', { text: 'On it…' });

    processVoiceCommandSocket(text, (event: string, data: any) => {
      if (event === 'agent:status') {
        this.emit(socketId, 'voice:status', { text: data.text });
      } else if (event === 'agent:done') {
        this.piAbortFns.delete(socketId);
        this.dispatch({ type: 'LLM_DONE', socketId, text: data.text || 'Done.' });
      } else if (event === 'agent:error') {
        this.piAbortFns.delete(socketId);
        this.dispatch({ type: 'LLM_DONE', socketId, text: data.text || 'Something went wrong.' });
      }
    }, complex, (abortFn: () => void) => {
      this.piAbortFns.set(socketId, abortFn);
    }).catch((err: any) => {
      console.error('[VoiceAgent] Pi agent error:', err);
      this.dispatch({ type: 'LLM_DONE', socketId, text: 'The agent encountered an error.' });
    });
  }

  // ── Quick status TTS (fire-and-forget, no queue coordination) ─────────────

  private speakStatus(socketId: string, text: string, signal: AbortSignal): void {
    const ctrl = new AbortController();
    // Abort if the LLM itself is aborted
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    this.chirp.synthesizeStreaming(
      text,
      ctrl.signal,
      (audio, isLast) => {
        if (ctrl.signal.aborted) return;
        this.emit(socketId, 'voice:audio_chunk', audio);
        if (isLast) this.emit(socketId, 'voice:audio_end');
      },
    ).catch(() => {});
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
        // Mark TTS as active on first chunk so barge-in works
        const s = this.sessions.get(socketId);
        if (s && !s.ttsActive) { s.ttsActive = true; this.sessions.set(socketId, s); }
        this.emit(socketId, 'voice:audio_chunk', audio);
        if (isLast) {
          const s2 = this.sessions.get(socketId);
          if (s2) { s2.ttsActive = false; this.sessions.set(socketId, s2); }
          this.emit(socketId, 'voice:audio_end');
        }
      },
    ).catch(err => {
      if (err?.name === 'AbortError' || err?.message === 'aborted' || ctrl.signal.aborted) return;
      console.error('[VoiceAgent] TTS error:', err);
      const s = this.sessions.get(socketId);
      if (s) { s.ttsActive = false; this.sessions.set(socketId, s); }
      this.dispatch({ type: 'TTS_DONE', socketId });
    });
  }
}
