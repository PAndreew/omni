import { useState, useEffect, useRef, useCallback } from 'react';

const WAKE_WORDS        = ['hey omni', 'okay omni', 'hi omni', 'hej omni', 'omni'];

// Strip Unicode diacritics so "Omnę" → "omne", "héj" → "hej", etc.
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Fuzzy wake word — catches Whisper mishearings of "omni"
function matchesWakeWord(norm) {
  if (WAKE_WORDS.some(w => norm.includes(w))) return true;
  // "hey/okay/ok/hi/hej" + anything starting with "omn"
  const hasGreeting = /\b(hey|okay|ok|hi|hej)\b/.test(norm);
  const hasOmni     = /\bomn/.test(norm);
  return hasGreeting && hasOmni;
}
const ENERGY_THRESHOLD  = 0.008;  // RMS from AnalyserNode byte data (0–1 normalised)
const SPEECH_CONFIRM_MS = 80;
const SILENCE_END_MS    = 1300;
const MAX_DURATION_MS   = 9000;

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
  const [chunkCount,       setChunkCount]       = useState(0);

  const onCommandRef  = useRef(onCommand);
  const onListeningRef = useRef(onListening);
  const onErrorRef     = useRef(onError);
  useEffect(() => { onCommandRef.current  = onCommand;  }, [onCommand]);
  useEffect(() => { onListeningRef.current = onListening; }, [onListening]);
  useEffect(() => { onErrorRef.current    = onError;    }, [onError]);

  const audioCtxRef  = useRef(null);
  const streamRef    = useRef(null);
  const stopPollRef  = useRef(null);   // () => void — tears down interval + recorder

  // VAD state (used inside the poll interval closure)
  const vadState     = useRef('idle'); // idle | confirming | recording | silence
  const silenceTimer = useRef(null);
  const maxTimer     = useRef(null);
  const confirmTimer = useRef(null);
  const recorderRef  = useRef(null);
  const chunksRef    = useRef([]);

  const wakeRef           = useRef(false);
  const wakeTimeout       = useRef(null);
  const recentTranscripts = useRef([]); // rolling 4-second window for split wake words

  const resetWake = useCallback(() => {
    wakeRef.current = false;
    setWakeWordDetected(false);
    clearTimeout(wakeTimeout.current);
    recentTranscripts.current = [];
  }, []);

  // ── Process transcript from Whisper ────────────────────────────────────────
  const handleTranscript = useCallback((text) => {
    const originalText = text.trim();
    const t = originalText.toLowerCase();
    if (!t) return;
    setTranscript(t);
    console.log('[Voice] Raw transcript:', t);

    // Normalize for wake word check: strip diacritics, punctuation, extra spaces
    const normalized = stripDiacritics(t).replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s{2,}/g, " ").trim();

    // Rolling 4-second buffer — catches "Hey." + "Omni." split across two VAD chunks
    const now = Date.now();
    recentTranscripts.current.push({ text: normalized, time: now });
    recentTranscripts.current = recentTranscripts.current.filter(e => now - e.time < 4000);
    const combined = recentTranscripts.current.map(e => e.text).join(' ');

    const matchesWake = matchesWakeWord(normalized) || (!wakeRef.current && matchesWakeWord(combined));

    if (!wakeRef.current) {
      if (matchesWake) {
        console.log('[Voice] Wake word detected in:', normalized);
        wakeRef.current = true;
        setWakeWordDetected(true);
        
        // Strip wake words
        let cmd = normalized;
        for (const w of WAKE_WORDS) cmd = cmd.replace(w, '');
        cmd = cmd.trim();

        // If command is in same transcript
        if (cmd.length > 2) { 
          console.log('[Voice] Command found in same transcript:', cmd);
          resetWake(); 
          let finalCmd = originalText;
          for (const w of WAKE_WORDS) {
            const re = new RegExp(`\\b${w}\\b`, 'gi');
            finalCmd = finalCmd.replace(re, '');
          }
          finalCmd = finalCmd.replace(/^[.,\s!]+|[.,\s!]+$/g, '').trim();
          onCommandRef.current?.(finalCmd); 
          return; 
        }
        
        clearTimeout(wakeTimeout.current);
        wakeTimeout.current = setTimeout(() => {
          console.log('[Voice] Wake timeout reached');
          resetWake();
        }, 20000);
      }
    } else {
      console.log('[Voice] Processing command in wake mode:', t);
      let finalCmd = originalText;
      for (const w of WAKE_WORDS) {
        const re = new RegExp(`\\b${w}\\b`, 'gi');
        finalCmd = finalCmd.replace(re, '');
      }
      finalCmd = finalCmd.replace(/^[.,\s!]+|[.,\s!]+$/g, '').trim();
      
      if (finalCmd.length > 2) { 
        console.log('[Voice] Shipping command:', finalCmd);
        resetWake(); 
        onCommandRef.current?.(finalCmd); 
      }
    }
  }, [resetWake]);

  // ── Send recorded blob to Whisper ──────────────────────────────────────────
  const sendBlob = useCallback(async (blob) => {
    try {
      const resp = await fetch('/api/voice/transcribe', {
        method: 'POST', body: blob,
        headers: { 'Content-Type': blob.type || 'audio/webm' },
      });
      if (!resp.ok) return;
      const { text } = await resp.json();
      if (text) handleTranscript(text);
    } catch (err) {
      console.warn('[Voice] transcribe error:', err);
    }
  }, [handleTranscript]);

  // ── Stop recorder and ship the blob ────────────────────────────────────────
  const stopAndSend = useCallback(() => {
    clearTimeout(silenceTimer.current); silenceTimer.current = null;
    clearTimeout(maxTimer.current);     maxTimer.current     = null;
    clearTimeout(confirmTimer.current); confirmTimer.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        chunksRef.current = [];
        sendBlob(blob);
      };
      rec.stop();
    }
    vadState.current = 'idle';
  }, [sendBlob]);

  // ── Start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    onErrorRef.current?.('S1');
    if (audioCtxRef.current?.state === 'running') return true;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    // Must create AudioContext synchronously inside the gesture handler (iOS Safari)
    const ctx = new AudioContext();
    // Unlock iOS audio — play a 1-sample silent buffer before any await
    const unlock = ctx.createBuffer(1, 1, ctx.sampleRate);
    const unlockSrc = ctx.createBufferSource();
    unlockSrc.buffer = unlock;
    unlockSrc.connect(ctx.destination);
    unlockSrc.start(0);
    await ctx.resume();
    onErrorRef.current?.(`S2 ctx=${ctx.state} rate=${ctx.sampleRate}`);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      onErrorRef.current?.('S3 mic ok');

      // AnalyserNode for VAD — pull-based, works on iOS Safari
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      // Connect to destination so iOS keeps the audio graph alive
      const gain = ctx.createGain(); gain.gain.value = 0;
      analyser.connect(gain); gain.connect(ctx.destination);

      const timeDomain = new Uint8Array(analyser.frequencyBinCount);

      // MediaRecorder for capture — no PCM encoding needed
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current   = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      // VAD poll every 50 ms
      const intervalId = setInterval(() => {
        analyser.getByteTimeDomainData(timeDomain);
        let sum = 0;
        for (const v of timeDomain) { const n = (v - 128) / 128; sum += n * n; }
        const energy = Math.sqrt(sum / timeDomain.length);
        setChunkCount(n => n + 1); // shows AnalyserNode is alive

        if (vadState.current === 'idle') {
          if (energy > ENERGY_THRESHOLD) {
            vadState.current = 'confirming';
            confirmTimer.current = setTimeout(() => {
              if (vadState.current === 'confirming') {
                vadState.current = 'recording';
                chunksRef.current = [];
                recorder.start();
                maxTimer.current = setTimeout(stopAndSend, MAX_DURATION_MS);
              }
            }, SPEECH_CONFIRM_MS);
          }
        } else if (vadState.current === 'confirming') {
          if (energy <= ENERGY_THRESHOLD) {
            vadState.current = 'idle';
            clearTimeout(confirmTimer.current);
          }
        } else if (vadState.current === 'recording') {
          if (energy <= ENERGY_THRESHOLD) {
            vadState.current = 'silence';
            silenceTimer.current = setTimeout(stopAndSend, SILENCE_END_MS);
          }
        } else if (vadState.current === 'silence') {
          if (energy > ENERGY_THRESHOLD) {
            vadState.current = 'recording';
            clearTimeout(silenceTimer.current); silenceTimer.current = null;
          }
        }
      }, 50);

      stopPollRef.current = () => {
        clearInterval(intervalId);
        clearTimeout(silenceTimer.current);
        clearTimeout(maxTimer.current);
        clearTimeout(confirmTimer.current);
        if (recorder.state !== 'inactive') recorder.stop();
      };
      audioCtxRef.current = ctx;

      setListening(true);
      onListeningRef.current?.(true);
      onErrorRef.current?.('S4 interval running');
      console.log('[Voice] AnalyserNode+MediaRecorder pipeline started, rate:', ctx.sampleRate);
      return true;
    } catch (err) {
      ctx.close().catch(() => {});
      console.error('[Voice] Failed to start:', err);
      onErrorRef.current?.(String(err));
      return false;
    }
  }, [stopAndSend]);

  // ── Stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stopPollRef.current?.();
    stopPollRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    vadState.current = 'idle';
    recorderRef.current = null;
    chunksRef.current   = [];
    resetWake();
    setListening(false);
    onListeningRef.current?.(false);
  }, [resetWake]);

  useEffect(() => () => stop(), [stop]);

  return { listening, transcript, wakeWordDetected, chunkCount, start, stop, supported: true };
}
