import { useState, useEffect, useRef, useCallback } from 'react';

const WAKE_WORDS = ['omni', 'hey omni', 'okay omni', 'hi omni'];

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
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const recognitionRef = useRef(null);
  const wakeRef = useRef(false);
  const timeoutRef = useRef(null);

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const resetWake = useCallback(() => {
    wakeRef.current = false;
    setWakeWordDetected(false);
    clearTimeout(timeoutRef.current);
  }, []);

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      onListening?.(true);
    };

    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const lastResult = results[results.length - 1];
      const text = lastResult[0].transcript.trim().toLowerCase();
      setTranscript(text);

      if (!wakeRef.current) {
        // Check for wake word
        const hasWake = WAKE_WORDS.some(w => text.includes(w));
        if (hasWake) {
          wakeRef.current = true;
          setWakeWordDetected(true);
          // Auto-reset wake word after 8s if no command follows
          clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(resetWake, 8000);
        }
        return;
      }

      // Wake word already detected — next final result is the command
      if (lastResult.isFinal) {
        // Strip wake word from command
        let command = text;
        for (const w of WAKE_WORDS) command = command.replace(w, '').trim();
        if (command.length > 2) {
          clearTimeout(timeoutRef.current);
          resetWake();
          onCommand?.(command);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return; // normal
      console.warn('[Voice]', event.error);
      onError?.(event.error);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      onListening?.(false);
      // Auto-restart for continuous listening
      setTimeout(start, 500);
    };

    recognition.start();
    recognitionRef.current = recognition;
  }, [supported, onCommand, onListening, onError, resetWake]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { listening, transcript, wakeWordDetected, start, stop, supported };
}
