import { useCallback, useEffect, useRef, useState } from 'react';

export function useGiziVoice() {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const current = useRef(null);
  const mounted = useRef(true);
  const update = useCallback((setter, value) => { if (mounted.current) setter(value); }, []);

  const stop = useCallback((message = '') => {
    const run = current.current;
    current.current = null;
    if (run) {
      clearTimeout(run.captureTimer); clearTimeout(run.idleTimer); clearTimeout(run.readyTimer); clearTimeout(run.startTimer);
      run.rejectReady?.(new Error('Voice stopped.'));
      run.stream?.getTracks().forEach(track => track.stop());
      run.node?.disconnect(); run.source?.disconnect(); run.silent?.disconnect();
      for (const source of run.playing) { try { source.stop(); } catch {} }
      if (run.ws) {
        run.ws.onopen = run.ws.onmessage = run.ws.onclose = run.ws.onerror = null;
        run.ws.close();
      }
      run.ctx?.close().catch(() => {});
    }
    update(setState, message ? 'error' : 'idle');
    update(setError, message);
  }, [update]);

  const end = useCallback(async () => {
    const run = current.current;
    if (!run?.stream || run.ending) return;
    run.ending = true;
    update(setState, 'working');
    clearTimeout(run.captureTimer);
    // Release physical capture immediately. Flush only already captured samples.
    run.stream.getTracks().forEach(track => track.stop());
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 150);
      run.flushed = () => { clearTimeout(timeout); resolve(); };
      run.node?.port.postMessage('flush');
    });
    run.node?.disconnect(); run.source?.disconnect(); run.silent?.disconnect();
    run.stream = null; run.node = null; run.source = null; run.silent = null;
    if (current.current !== run) return;
    if (run.ws.readyState === WebSocket.OPEN) run.ws.send(JSON.stringify({ type: 'end' }));
    update(setState, 'working');
  }, [update]);

  const start = useCallback(async (key = '') => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      stop('Microphone access needs HTTPS (or localhost). Open the secure phone address.'); return;
    }
    let run = current.current;
    if (run?.stream || run?.starting) return;
    if (!run) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) { stop('This browser does not support audio capture.'); return; }
      run = { ctx: new AudioContextClass(), playing: new Set(), nextAudio: 0, ws: null };
      current.current = run;
    }
    // Called directly from the click handler to unlock audio on iOS.
    const resume = run.ctx.resume();
    const unlock = run.ctx.createBufferSource();
    unlock.buffer = run.ctx.createBuffer(1, 1, run.ctx.sampleRate);
    unlock.connect(run.ctx.destination); unlock.start();
    run.starting = true; run.ending = false;
    clearTimeout(run.idleTimer); clearTimeout(run.readyTimer);
    for (const source of run.playing) { try { source.stop(); } catch {} }
    run.playing.clear(); run.nextAudio = 0;
    update(setState, 'connecting'); update(setError, ''); update(setTranscript, ''); update(setReply, '');
    run.startTimer = setTimeout(() => { if (current.current === run) stop('Microphone or voice startup timed out.'); }, 25000);
    try {
      await resume;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (current.current !== run) { stream.getTracks().forEach(track => track.stop()); return; }
      run.stream = stream;
      stream.getTracks().forEach(track => { track.onended = () => { if (current.current === run && !run.ending) stop('Microphone disconnected.'); }; });
      if (!run.ctx.audioWorklet) throw new Error('This browser needs AudioWorklet support. Try an up-to-date browser.');
      if (!run.workletLoaded) { await run.ctx.audioWorklet.addModule('/gizi/pcm-worklet.js'); run.workletLoaded = true; }
      if (current.current !== run) return;
      if (!run.ws) {
        const session = await fetch('/gizi/session', { method: 'POST' });
        if (!session.ok) throw new Error('Cannot connect to Gizi.');
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/gizi/socket`);
        run.ws = ws;
        await new Promise((resolve, reject) => {
          run.rejectReady = reject;
          ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', key: key.trim() }));
          ws.onerror = () => { reject(new Error('Cannot connect to Gizi.')); if (current.current === run) stop('Cannot connect to Gizi.'); };
          ws.onclose = event => {
            reject(new Error('Voice connection closed.'));
            if (current.current === run) stop(event.wasClean ? '' : 'Voice connection lost. No changes will be automatically repeated.');
          };
          ws.onmessage = event => {
            if (current.current !== run) return;
            try {
              const message = JSON.parse(event.data);
              if (message.type === 'ready') { run.rejectReady = null; resolve(); }
              if (message.type === 'error') { reject(new Error(message.message)); stop(message.message); }
              if (message.type === 'input_ended') void end();
              if (message.type === 'status' && ['transcribing', 'working', 'synthesizing'].includes(message.state)) update(setState, message.state);
              if (message.type === 'warning') update(setError, message.message);
              if (message.type === 'transcript') {
                const setter = message.who === 'user' ? setTranscript : setReply;
                update(setter, value => (value + message.text).slice(-3000));
              }
              if (message.type === 'interrupted') {
                for (const source of run.playing) { try { source.stop(); } catch {} }
                run.playing.clear(); run.nextAudio = 0;
              }
              if (message.type === 'audio') {
                const raw = atob(message.data);
                const buffer = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
                if (buffer.length % 2) throw new Error('Invalid reply audio');
                const samples = new DataView(buffer.buffer);
                const audio = run.ctx.createBuffer(1, buffer.length / 2, 24000);
                const channel = audio.getChannelData(0);
                for (let i = 0; i < channel.length; i++) channel[i] = samples.getInt16(i * 2, true) / 32768;
                const source = run.ctx.createBufferSource(); source.buffer = audio; source.connect(run.ctx.destination);
                const when = Math.max(run.ctx.currentTime, run.nextAudio);
                if (when - run.ctx.currentTime > 15) throw new Error('Reply audio queue too long');
                run.nextAudio = when + audio.duration;
                run.playing.add(source); source.onended = () => { run.playing.delete(source); source.disconnect(); };
                source.start(when); update(setState, 'speaking');
              }
              if (message.type === 'turn_complete') {
                clearTimeout(run.readyTimer);
                run.readyTimer = setTimeout(() => {
                  if (current.current !== run || run.stream) return;
                  update(setState, 'ready');
                  run.idleTimer = setTimeout(() => { if (current.current === run) stop(); }, 15000);
                }, Math.max(0, (run.nextAudio - run.ctx.currentTime) * 1000) + 100);
              }
            } catch { stop('Voice playback failed. Please reconnect.'); }
          };
        });
      }
      if (current.current !== run) return;
      clearTimeout(run.startTimer);
      run.ws.send(JSON.stringify({ type: 'start' }));
      run.source = run.ctx.createMediaStreamSource(run.stream);
      run.node = new AudioWorkletNode(run.ctx, 'gizi-capture');
      run.silent = run.ctx.createGain(); run.silent.gain.value = 0;
      run.node.port.onmessage = event => {
        if (event.data.type === 'flushed') { run.flushed?.(); return; }
        if (current.current !== run || run.ws.readyState !== WebSocket.OPEN) return;
        if (run.ws.bufferedAmount > 64000) { stop('Connection too slow for live audio.'); return; }
        run.ws.send(event.data.buffer);
      };
      run.source.connect(run.node); run.node.connect(run.silent); run.silent.connect(run.ctx.destination);
      update(setState, 'listening');
      run.captureTimer = setTimeout(() => void end(), 14000);
    } catch (cause) {
      if (current.current === run) stop(cause.name === 'NotAllowedError' ? 'Microphone permission denied. Allow it in your browser settings.' : cause.name === 'NotFoundError' ? 'No microphone found. Use your phone or connect a USB microphone.' : cause.message || 'Voice startup failed.');
    } finally { run.starting = false; }
  }, [end, stop, update]);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) stop(); };
    const pagehide = () => stop();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
    return () => { mounted.current = false; stop(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); };
  }, [stop]);
  return { state, error, transcript, reply, start, end, stop };
}
