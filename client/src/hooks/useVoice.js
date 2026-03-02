import { useState, useEffect, useRef, useCallback } from 'react';

const WAKE_WORDS         = ['hey omni', 'okay omni', 'hi omni', 'hej omni'];
const SAMPLE_RATE        = 16000;
const ENERGY_THRESHOLD   = 0.012;   // RMS level that counts as speech
const SPEECH_CONFIRM_MS  = 250;     // must be loud for this long before we start recording
const SILENCE_END_MS     = 1300;    // silence after speech → send for transcription
const MAX_DURATION_MS    = 9000;    // force-send even if no silence (long utterance)

// ── WAV encoder ───────────────────────────────────────────────────────────────
function encodeWAV(samples /* Int16Array */, sampleRate) {
  const buf  = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str  = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0,  'RIFF');  view.setUint32(4,  36 + samples.length * 2, true);
  str(8,  'WAVE');  str(12, 'fmt ');
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1,  true);          // PCM
  view.setUint16(22, 1,  true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2,  true);          // block align
  view.setUint16(34, 16, true);          // bits per sample
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

// ── RMS energy of an Int16 chunk ──────────────────────────────────────────────
function rms(int16) {
  let sum = 0;
  for (let i = 0; i < int16.length; i++) sum += (int16[i] / 32768) ** 2;
  return Math.sqrt(sum / int16.length);
}

// ── TTS ───────────────────────────────────────────────────────────────────────
export function useTTS() {
  const speak = useCallback((text, { rate = 1, pitch = 1, voice = null } = {}) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate; u.pitch = pitch;
    if (voice) {
      const match = window.speechSynthesis.getVoices()
        .find(v => v.name.toLowerCase().includes(voice.toLowerCase()));
      if (match) u.voice = match;
    }
    window.speechSynthesis.speak(u);
  }, []);

  const cancel = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  return { speak, cancel };
}

// ── Voice recognition ─────────────────────────────────────────────────────────
export function useVoiceRecognition({ onCommand, onListening, onError } = {}) {
  const [listening,        setListening]        = useState(false);
  const [transcript,       setTranscript]       = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);

  const onCommandRef = useRef(onCommand);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  // audio pipeline refs
  const audioCtxRef = useRef(null);
  const streamRef   = useRef(null);
  const workletRef  = useRef(null);

  // VAD state
  const vadState      = useRef('idle');   // 'idle' | 'confirming' | 'recording' | 'silence'
  const vadBuffer     = useRef([]);       // accumulated Int16 samples for current utterance
  const silenceTimer  = useRef(null);
  const maxTimer      = useRef(null);
  const confirmTimer  = useRef(null);

  // wake-word state
  const wakeRef     = useRef(false);
  const wakeTimeout = useRef(null);

  const resetWake = useCallback(() => {
    wakeRef.current = false;
    setWakeWordDetected(false);
    clearTimeout(wakeTimeout.current);
  }, []);

  // ── Send accumulated audio to Whisper ──────────────────────────────────────
  const sendAudio = useCallback(async () => {
    clearTimeout(silenceTimer.current);
    clearTimeout(maxTimer.current);
    clearTimeout(confirmTimer.current);

    const chunks = vadBuffer.current.splice(0);
    if (chunks.length === 0) { vadState.current = 'idle'; return; }
    vadState.current = 'idle';

    // Flatten to one Int16Array
    const total   = chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Int16Array(total);
    let off = 0;
    for (const c of chunks) { samples.set(c, off); off += c.length; }

    try {
      const wav  = encodeWAV(samples, SAMPLE_RATE);
      const resp = await fetch('/api/voice/transcribe', { method: 'POST', body: wav,
        headers: { 'Content-Type': 'audio/wav' } });
      if (!resp.ok) return;

      const { text } = await resp.json();
      if (!text) return;

      const t = text.trim().toLowerCase();
      setTranscript(t);
      console.log('[Voice]', t);

      if (!wakeRef.current) {
        if (WAKE_WORDS.some(w => t.includes(w))) {
          wakeRef.current = true;
          setWakeWordDetected(true);
          // command might be in the same utterance, after the wake word
          let cmd = t;
          for (const w of WAKE_WORDS) cmd = cmd.replace(w, '').trim();
          if (cmd.length > 2) { resetWake(); onCommandRef.current?.(cmd); return; }
          clearTimeout(wakeTimeout.current);
          wakeTimeout.current = setTimeout(resetWake, 8000);
        }
      } else {
        // we're in command mode — this utterance is the command
        let cmd = t;
        for (const w of WAKE_WORDS) cmd = cmd.replace(w, '').trim();
        if (cmd.length > 2) { resetWake(); onCommandRef.current?.(cmd); }
      }
    } catch (err) {
      console.warn('[Voice] transcribe error:', err);
    }
  }, [resetWake]);

  // ── AudioWorklet message handler (called per ~128-sample chunk) ────────────
  const handleChunk = useCallback((int16) => {
    const energy = rms(int16);

    if (vadState.current === 'idle') {
      if (energy > ENERGY_THRESHOLD) {
        vadState.current = 'confirming';
        vadBuffer.current = [int16];
        confirmTimer.current = setTimeout(() => {
          // If we're still in confirming state after SPEECH_CONFIRM_MS, promote to recording
          if (vadState.current === 'confirming') {
            vadState.current = 'recording';
            maxTimer.current = setTimeout(sendAudio, MAX_DURATION_MS);
          }
        }, SPEECH_CONFIRM_MS);
      }
    } else if (vadState.current === 'confirming') {
      vadBuffer.current.push(int16);
      if (energy <= ENERGY_THRESHOLD) {
        // Was just noise — abort
        vadState.current = 'idle';
        vadBuffer.current = [];
        clearTimeout(confirmTimer.current);
      }
    } else if (vadState.current === 'recording') {
      vadBuffer.current.push(int16);
      if (energy <= ENERGY_THRESHOLD) {
        vadState.current = 'silence';
        silenceTimer.current = setTimeout(sendAudio, SILENCE_END_MS);
      }
    } else if (vadState.current === 'silence') {
      vadBuffer.current.push(int16);
      if (energy > ENERGY_THRESHOLD) {
        // Speech resumed — cancel the silence timer and go back to recording
        vadState.current = 'recording';
        clearTimeout(silenceTimer.current);
      }
    }
  }, [sendAudio]);

  // ── Start mic + AudioWorklet pipeline ──────────────────────────────────────
  const start = useCallback(async () => {
    if (audioCtxRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1,
                 echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.audioWorklet.addModule('/audio-processor.js');
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'pcm-processor');
      source.connect(worklet);
      workletRef.current = worklet;

      worklet.port.onmessage = ({ data }) => handleChunk(new Int16Array(data));

      setListening(true);
      onListening?.(true);
      console.log('[Voice] Whisper mic pipeline started');
    } catch (err) {
      console.error('[Voice] Failed to start:', err);
      onError?.(err.message);
    }
  }, [handleChunk, onListening, onError]);

  const stop = useCallback(() => {
    clearTimeout(silenceTimer.current);
    clearTimeout(maxTimer.current);
    clearTimeout(confirmTimer.current);
    clearTimeout(wakeTimeout.current);
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    vadState.current = 'idle';
    vadBuffer.current = [];
    resetWake();
    setListening(false);
    onListening?.(false);
  }, [resetWake, onListening]);

  useEffect(() => () => stop(), [stop]);

  return { listening, transcript, wakeWordDetected, start, stop, supported: true };
}
