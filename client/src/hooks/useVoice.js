import { useState, useEffect, useRef, useCallback } from 'react';

const WAKE_WORDS      = ['hey omni', 'okay omni', 'hi omni', 'hej omni'];
const WAKE_CONFIDENCE = 0.60;   // slightly relaxed for accented/non-native speech
const LANGS           = ['en-US', 'hu-HU'];

export function useTTS() {
  const speak = useCallback((text, { rate = 1, pitch = 1, voice = null } = {}) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (voice) {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.name.toLowerCase().includes(voice.toLowerCase()));
      if (match) utterance.voice = match;
    }
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  return { speak, cancel };
}

export function useVoiceRecognition({ onCommand, onListening, onError } = {}) {
  const [listening,        setListening]        = useState(false);
  const [transcript,       setTranscript]       = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);

  // Keep callback ref fresh so recognition closures always call the latest version
  const onCommandRef  = useRef(onCommand);
  const onListeningRef = useRef(onListening);
  useEffect(() => { onCommandRef.current  = onCommand;  }, [onCommand]);
  useEffect(() => { onListeningRef.current = onListening; }, [onListening]);

  const instancesRef  = useRef({});   // { 'en-US': SpeechRecognition, 'hu-HU': ... }
  const wakeRef       = useRef(false);
  const timeoutRef    = useRef(null);
  const lastCmdRef    = useRef(0);    // timestamp — dedup window between parallel instances

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const resetWake = useCallback(() => {
    wakeRef.current = false;
    setWakeWordDetected(false);
    clearTimeout(timeoutRef.current);
  }, []);

  const fireCommand = useCallback((command) => {
    const now = Date.now();
    if (now - lastCmdRef.current < 1500) return;   // drop duplicate from the other instance
    lastCmdRef.current = now;
    resetWake();
    onCommandRef.current?.(command);
  }, [resetWake]);

  const startLang = useCallback((lang) => {
    if (!supported) return null;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SpeechRecognition();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = lang;
    r.maxAlternatives = 1;

    r.onstart = () => {
      setListening(true);
      onListeningRef.current?.(true);
    };

    r.onresult = (event) => {
      const results = Array.from(event.results);
      const last    = results[results.length - 1];
      const text    = last[0].transcript.trim().toLowerCase();
      setTranscript(text);

      if (!wakeRef.current) {
        const conf    = last[0].confidence ?? 1;
        const hasWake = conf >= WAKE_CONFIDENCE && WAKE_WORDS.some(w => text.includes(w));
        if (hasWake) {
          wakeRef.current = true;
          setWakeWordDetected(true);
          let cmd = text;
          for (const w of WAKE_WORDS) cmd = cmd.replace(w, '').trim();
          if (cmd.length > 2 && last.isFinal) { fireCommand(cmd); return; }
          clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(resetWake, 8000);
        }
        return;
      }

      if (last.isFinal) {
        let cmd = text;
        for (const w of WAKE_WORDS) cmd = cmd.replace(w, '').trim();
        if (cmd.length > 2) fireCommand(cmd);
      }
    };

    r.onerror = (event) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'audio-capture') {
        // Browser doesn't support parallel mic streams — silently drop this language
        delete instancesRef.current[lang];
        return;
      }
      console.warn('[Voice]', lang, event.error);
      onError?.(event.error);
    };

    r.onend = () => {
      // Only auto-restart if we're still the registered instance for this language
      if (instancesRef.current[lang] !== r) return;
      setTimeout(() => {
        if (instancesRef.current[lang] !== r) return;
        const nr = startLang(lang);
        if (nr) instancesRef.current[lang] = nr;
        else delete instancesRef.current[lang];
      }, 500);
      if (Object.keys(instancesRef.current).length === 0) {
        setListening(false);
        onListeningRef.current?.(false);
      }
    };

    try { r.start(); return r; } catch { return null; }
  }, [supported, onError, fireCommand, resetWake]);

  const start = useCallback(() => {
    if (!supported || Object.keys(instancesRef.current).length > 0) return;
    for (const lang of LANGS) {
      const r = startLang(lang);
      if (r) instancesRef.current[lang] = r;
    }
  }, [supported, startLang]);

  const stop = useCallback(() => {
    Object.values(instancesRef.current).forEach(r => { try { r.stop(); } catch {} });
    instancesRef.current = {};
    clearTimeout(timeoutRef.current);
    setListening(false);
    onListeningRef.current?.(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { listening, transcript, wakeWordDetected, start, stop, supported };
}
