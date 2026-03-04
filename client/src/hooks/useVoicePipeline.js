// ─── useVoicePipeline ─────────────────────────────────────────────────────────
// Server-side voice pipeline: Deepgram STT → OpenRouter LLM → Google Chirp TTS
// Browser sends raw opus chunks; server handles everything else.

import { useState, useRef, useCallback, useEffect } from 'react';
import { getSocket } from './useSocket.js';

export function useVoicePipeline() {
  const [active,        setActive]        = useState(false);
  const [state,         setState]         = useState('idle'); // idle | listening | awake | thinking | responding
  const [streamingText, setStreamingText] = useState('');
  const [transcript,    setTranscript]    = useState('');

  const recorderRef   = useRef(null);
  const streamRef     = useRef(null);
  const audioCtxRef   = useRef(null);
  const audioQueue    = useRef([]);
  const isPlayingRef  = useRef(false);
  const sourceRef     = useRef(null);   // current AudioBufferSourceNode
  const ttsActiveRef  = useRef(false);  // true while TTS is playing — mute mic to prevent echo

  // ── TTS Playback via Web Audio API ────────────────────────────────────────

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const playNextChunk = useCallback(async () => {
    if (isPlayingRef.current || audioQueue.current.length === 0) return;
    isPlayingRef.current = true;

    const arrayBuf = audioQueue.current.shift();
    try {
      const ctx = getAudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      sourceRef.current = src;
      src.onended = () => {
        isPlayingRef.current = false;
        playNextChunk();
      };
      src.start(0);
    } catch (err) {
      console.warn('[VoicePipeline] Audio decode error:', err);
      isPlayingRef.current = false;
      playNextChunk();
    }
  }, [getAudioCtx]);

  const stopAudio = useCallback(() => {
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current  = null;
    audioQueue.current = [];
    isPlayingRef.current = false;
  }, []);

  // ── Socket event listeners ────────────────────────────────────────────────

  useEffect(() => {
    const socket = getSocket();

    const onTranscript = ({ text, isFinal }) => {
      setTranscript(text);
      if (isFinal) setStreamingText('');
    };

    const onAwake = () => setState('awake');

    const onStatus = ({ text }) => {
      const t = text.toLowerCase();
      if (t.includes('thinking') || t.includes('checking')) setState('thinking');
      else if (t.includes('command')) setState('awake');
      else setState('listening');
    };

    const onStream = ({ delta }) => {
      setState('responding');
      setStreamingText(prev => prev + delta);
    };

    const onDone = () => {
      setState('responding'); // stays until TTS_END
    };

    const onAudioChunk = (data) => {
      // data arrives as ArrayBuffer or Buffer
      const ab = data instanceof ArrayBuffer ? data
        : data?.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : null;
      if (!ab) return;
      ttsActiveRef.current = true;  // mute mic while TTS is playing
      audioQueue.current.push(ab);
      playNextChunk();
    };

    const onAudioEnd = () => {
      // Wait for queue to drain, then unmute mic and go back to listening
      const check = setInterval(() => {
        if (!isPlayingRef.current && audioQueue.current.length === 0) {
          clearInterval(check);
          // Small delay so the last audio frame clears the mic before we start sending again
          setTimeout(() => { ttsActiveRef.current = false; }, 400);
          setState('listening');
          setStreamingText('');
        }
      }, 100);
    };

    const onInterrupt = () => {
      stopAudio();
      ttsActiveRef.current = false;
      setStreamingText('');
      setState('listening');
    };

    socket.on('voice:transcript',  onTranscript);
    socket.on('voice:awake',       onAwake);
    socket.on('voice:status',      onStatus);
    socket.on('voice:stream',      onStream);
    socket.on('voice:done',        onDone);
    socket.on('voice:audio_chunk', onAudioChunk);
    socket.on('voice:audio_end',   onAudioEnd);
    socket.on('voice:interrupt',   onInterrupt);

    return () => {
      socket.off('voice:transcript',  onTranscript);
      socket.off('voice:awake',       onAwake);
      socket.off('voice:status',      onStatus);
      socket.off('voice:stream',      onStream);
      socket.off('voice:done',        onDone);
      socket.off('voice:audio_chunk', onAudioChunk);
      socket.off('voice:audio_end',   onAudioEnd);
      socket.off('voice:interrupt',   onInterrupt);
    };
  }, [playNextChunk, stopAudio]);

  // ── Mic start ─────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (active) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, sampleRate: 48000 },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });
      recorderRef.current = recorder;

      const socket = getSocket();
      socket.emit('voice:start');

      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        if (ttsActiveRef.current) return;  // don't send mic audio while TTS is playing (echo prevention)
        const buf = await e.data.arrayBuffer();
        socket.emit('voice:audio', buf);
      };

      recorder.start(250); // 250ms timeslices
      setActive(true);
      setState('listening');
      return true;
    } catch (err) {
      console.error('[VoicePipeline] Failed to start mic:', err);
      return false;
    }
  }, [active]);

  // ── Mic stop ──────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    stopAudio();
    getSocket().emit('voice:stop');

    setActive(false);
    setState('idle');
    setStreamingText('');
  }, [stopAudio]);

  // Cleanup on unmount
  useEffect(() => () => { stop(); }, [stop]); // eslint-disable-line react-hooks/exhaustive-deps

  return { active, state, streamingText, transcript, start, stop };
}
