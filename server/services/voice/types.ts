// ─── Voice Pipeline Types ────────────────────────────────────────────────────

export type VoiceStateId = 'IDLE' | 'LISTENING' | 'AWAKE' | 'RESPONDING' | 'INTERRUPTED';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface VoiceSession {
  socketId: string;
  state: VoiceStateId;
  history: ConversationMessage[];
  deepgramLiveClient: any;
  ttsAbortController: AbortController | null;
  llmAbortController: AbortController | null;
}

// ─── Events (from external sources → state machine) ─────────────────────────

export type VoiceEvent =
  | { type: 'AUDIO_START';        socketId: string }
  | { type: 'AUDIO_CHUNK';        socketId: string; chunk: Buffer }
  | { type: 'AUDIO_STOP';         socketId: string }
  | { type: 'TRANSCRIPT_FINAL';   socketId: string; text: string }
  | { type: 'TRANSCRIPT_INTERIM'; socketId: string; text: string }
  | { type: 'SPEECH_STARTED';     socketId: string }
  | { type: 'LLM_DELTA';          socketId: string; delta: string }
  | { type: 'LLM_DONE';           socketId: string; text: string }
  | { type: 'TTS_DONE';           socketId: string }
  | { type: 'WAKE_TIMEOUT';       socketId: string }
  | { type: 'DISCONNECT';         socketId: string };

// ─── Actions (state machine → agent executor) ───────────────────────────────

export type VoiceAction =
  | { type: 'START_LLM';        text: string }
  | { type: 'ABORT_TTS' }
  | { type: 'ABORT_LLM' }
  | { type: 'EMIT_TRANSCRIPT';  text: string; isFinal: boolean }
  | { type: 'EMIT_STREAM';      delta: string }
  | { type: 'EMIT_STATUS';      text: string }
  | { type: 'EMIT_DONE';        text: string }
  | { type: 'EMIT_INTERRUPT' }
  | { type: 'GREET_USER' }
  | { type: 'START_WAKE_TIMEOUT' }
  | { type: 'CANCEL_WAKE_TIMEOUT' }
  | { type: 'ADD_TO_HISTORY';   role: 'user' | 'assistant'; text: string }
  | { type: 'CLEANUP' };

// ─── Misc ────────────────────────────────────────────────────────────────────

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface AgentTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}
