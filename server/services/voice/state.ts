// ─── Pure State Machine ───────────────────────────────────────────────────────
// No I/O. All decisions are made based on current state + incoming event.

import type { VoiceSession, VoiceEvent, VoiceAction } from './types.js';

const WAKE_WORDS  = ['omni', 'hey omni', 'hé omni', 'hej omni'];
const STOP_WORDS  = ['stop', 'cancel', 'pause', 'halt', 'abort', 'never mind', 'forget it'];
const RESUME_WORDS = ['resume', 'continue session', 'open session', 'go back'];

function isWakeWord(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[.,!?]/g, '');
  return WAKE_WORDS.some(w => t === w || t.endsWith(w));
}

function isStopCommand(text: string): boolean {
  const t = text.toLowerCase().trim();
  return STOP_WORDS.some(w => t.includes(w));
}

function isResumeCommand(text: string): boolean {
  const t = text.toLowerCase().trim();
  return RESUME_WORDS.some(w => t.includes(w));
}

export function processEvent(
  session: VoiceSession,
  event: VoiceEvent,
): { session: VoiceSession; actions: VoiceAction[] } {
  const actions: VoiceAction[] = [];
  let nextState = session.state;

  switch (event.type) {

    case 'AUDIO_START':
      if (session.state === 'IDLE') {
        nextState = 'LISTENING';
      }
      break;

    case 'TRANSCRIPT_INTERIM':
      if (session.state === 'LISTENING' || session.state === 'AWAKE') {
        actions.push({ type: 'EMIT_TRANSCRIPT', text: event.text, isFinal: false });
      }
      break;

    case 'TRANSCRIPT_FINAL':
      if (session.state === 'LISTENING') {
        if (isWakeWord(event.text)) {
          // Wake word detected → greet; wake timeout starts after greeting finishes playing
          nextState = 'AWAKE';
          actions.push({ type: 'GREET_USER' });
        }
        // Non-wake-word speech while in LISTENING is silently ignored
      } else if (session.state === 'AWAKE') {
        if (isResumeCommand(event.text)) {
          nextState = 'RESPONDING';
          actions.push({ type: 'CANCEL_WAKE_TIMEOUT' });
          actions.push({ type: 'EMIT_STATUS', text: 'Resuming session…' });
          actions.push({ type: 'START_THINKING_TIMEOUT' });
          actions.push({ type: 'RESUME_SESSION' });
        } else {
          nextState = 'RESPONDING';
          actions.push({ type: 'CANCEL_WAKE_TIMEOUT' });
          actions.push({ type: 'EMIT_TRANSCRIPT', text: event.text, isFinal: true });
          actions.push({ type: 'ADD_TO_HISTORY', role: 'user', text: event.text });
          actions.push({ type: 'START_THINKING_TIMEOUT' });
          actions.push({ type: 'START_LLM', text: event.text });
        }
      } else if (session.state === 'RESPONDING') {
        // Stop command during thinking → abort and go back to awake
        if (isStopCommand(event.text)) {
          nextState = 'AWAKE';
          actions.push({ type: 'ABORT_TTS' });
          actions.push({ type: 'ABORT_LLM' });
          actions.push({ type: 'CANCEL_THINKING_TIMEOUT' });
          actions.push({ type: 'EMIT_STATUS', text: 'Say your command…' });
          actions.push({ type: 'START_WAKE_TIMEOUT' });
        }
        // Other speech during thinking → ignore, let pi finish
      }
      break;

    case 'WAKE_TIMEOUT':
      if (session.state === 'AWAKE') {
        nextState = 'LISTENING';
        actions.push({ type: 'EMIT_STATUS', text: 'Listening…' });
      }
      break;

    case 'THINKING_TIMEOUT':
      if (session.state === 'RESPONDING') {
        nextState = 'AWAKE';
        actions.push({ type: 'ABORT_TTS' });
        actions.push({ type: 'ABORT_LLM' });
        actions.push({ type: 'EMIT_STATUS', text: 'Say your command…' });
        actions.push({ type: 'START_WAKE_TIMEOUT' });
      }
      break;

    case 'SPEECH_STARTED':
      // Only barge-in if TTS is actively playing — ignore SpeechStarted from user's own command
      if (session.state === 'RESPONDING' && session.ttsActive) {
        nextState = 'AWAKE';
        actions.push({ type: 'ABORT_TTS' });
        actions.push({ type: 'ABORT_LLM' });
        actions.push({ type: 'EMIT_INTERRUPT' });
        actions.push({ type: 'START_WAKE_TIMEOUT' });
      }
      break;

    case 'LLM_DELTA':
      if (session.state === 'RESPONDING') {
        actions.push({ type: 'EMIT_STREAM', delta: event.delta });
      }
      break;

    case 'LLM_DONE':
      if (session.state === 'RESPONDING') {
        actions.push({ type: 'CANCEL_THINKING_TIMEOUT' });
        actions.push({ type: 'ADD_TO_HISTORY', role: 'assistant', text: event.text });
        actions.push({ type: 'EMIT_DONE', text: event.text });
      }
      break;

    case 'TTS_DONE':
      // Fires when client confirms audio finished playing (greeting OR command response)
      if (session.state === 'AWAKE' || session.state === 'RESPONDING') {
        nextState = 'AWAKE';
        actions.push({ type: 'EMIT_STATUS', text: 'Say your command…' });
        actions.push({ type: 'START_WAKE_TIMEOUT' });
      }
      break;

    case 'AUDIO_STOP':
      // Audio stopped but keep current state — Deepgram will still process buffered audio
      break;

    case 'DISCONNECT':
      actions.push({ type: 'CLEANUP' });
      break;
  }

  return {
    session: { ...session, state: nextState },
    actions,
  };
}
