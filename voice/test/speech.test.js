import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToWav, wavToPcm, transcribeAudio, connectRecordedSpeech, HAPPY_CHIRP_PCM, TRANSCRIBE_MODEL } from '../speech.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await tick(); }
}

test('WAV conversion preserves PCM and validates format, rate, and truncation', () => {
  const pcm = Buffer.alloc(3200, 1);
  const wav = pcmToWav(pcm, 24000);
  assert.deepEqual(wavToPcm(wav), pcm);
  assert.throws(() => wavToPcm(pcmToWav(pcm, 16000)), /format/);
  assert.throws(() => wavToPcm(wav.subarray(0, 50)), /Truncated/);
  assert.throws(() => pcmToWav(Buffer.alloc(3)), /Invalid/);
});

test('Gemini uses whole-recording transcription-only instructions, structured text and complete WAV', async () => {
  let options;
  const client = { models: { generateContent: async params => { options = params; return { text: JSON.stringify({ transcript: 'Hány dal van a csajok listán?' }) }; } } };
  const transcript = await transcribeAudio({ client, pcm: Buffer.alloc(3200), signal: new AbortController().signal });
  assert.equal(transcript, 'Hány dal van a csajok listán?');
  assert.equal(options.model, TRANSCRIBE_MODEL);
  assert.match(options.config.systemInstruction, /Hungarian \(hu-HU\)/);
  assert.match(options.config.systemInstruction, /Do not translate, answer, summarize/);
  assert.equal(options.config.responseMimeType, 'application/json');
  assert.equal(options.config.temperature, 0);
  assert.equal(options.contents[0].parts[0].inlineData.mimeType, 'audio/wav');
  assert.equal(Buffer.from(options.contents[0].parts[0].inlineData.data, 'base64').toString('ascii', 0, 4), 'RIFF');
  assert.equal(options.config.tools, undefined);
  assert.equal(options.config.audioTranscriptionConfig, undefined);
});

test('blank transcript is rejected and cannot become an agent request', async () => {
  await assert.rejects(transcribeAudio({ client: { models: { generateContent: async () => ({ text: JSON.stringify({ transcript: ' ' }) }) } }, pcm: Buffer.alloc(3200), signal: new AbortController().signal }), /No usable transcript/);
});

test('no audio transcription before Send; Pi receives exact transcript once; speech follows verified reply', async () => {
  const order = [], events = [];
  const exact = 'Indítsd el Farruko Pepas című számát!';
  const bridge = connectRecordedSpeech({
    agent: { ask: async text => { assert.equal(text, exact); order.push('agent'); return { status: 'completed', reply: 'Elküldtem a lejátszást.' }; }, dispose() {} },
    transcribe: async () => { order.push('transcribe'); return exact; },
    synthesize: async reply => { assert.equal(reply, 'Elküldtem a lejátszást.'); order.push('speak'); return Buffer.alloc(9600); },
    emit: event => events.push(event), closed: message => assert.fail(message),
  });
  bridge.start(); bridge.audio(Buffer.alloc(3200));
  await tick(); assert.deepEqual(order, []);
  bridge.end(); assert.throws(() => bridge.end(), /No active/);
  await until(() => events.some(event => event.type === 'turn_complete'));
  assert.deepEqual(order, ['transcribe', 'agent', 'speak']);
  assert.equal(events.filter(event => event.type === 'transcript' && event.who === 'user').length, 1);
  assert.ok(events.some(event => event.type === 'audio'));
  bridge.dispose();
});

test('Stop during transcription cancels it and prevents any Pi operation or reply', async () => {
  let resolve, signal, asked = 0, disposed = 0;
  const events = [];
  const bridge = connectRecordedSpeech({
    agent: { ask: async () => { asked++; }, dispose: () => { disposed++; } },
    transcribe: async (_pcm, s) => { signal = s; return new Promise(r => { resolve = r; }); },
    synthesize: () => assert.fail('No synthesis after cancellation'), emit: e => events.push(e), closed: () => assert.fail('No late error'),
  });
  bridge.start(); bridge.audio(Buffer.alloc(3200)); bridge.end();
  bridge.dispose(); bridge.dispose();
  assert.equal(signal.aborted, true); assert.equal(disposed, 1);
  resolve('Play Pepas'); await tick();
  assert.equal(asked, 0); assert.ok(!events.some(e => e.type === 'audio'));
});

test('successful playback feedback emits only a short local happy chirp, without TTS', async () => {
  const events = [];
  const bridge = connectRecordedSpeech({
    agent: { ask: async () => ({ status: 'completed', feedback: 'chirp', reply: '' }), dispose() {} },
    transcribe: async () => 'Indítsd el az órást!', synthesize: () => assert.fail('Success chirp must be local, not cloud TTS'),
    emit: event => events.push(event), closed: message => assert.fail(message),
  });
  bridge.start(); bridge.audio(Buffer.alloc(3200)); bridge.end();
  await until(() => events.some(event => event.type === 'turn_complete'));
  const audio = events.filter(event => event.type === 'audio');
  assert.equal(audio.length, 1); assert.deepEqual(Buffer.from(audio[0].data, 'base64'), HAPPY_CHIRP_PCM);
  assert.ok(HAPPY_CHIRP_PCM.length < 24000 * 2 / 2, 'chirp must be shorter than half a second');
  assert.ok(!events.some(event => event.type === 'transcript' && event.who === 'assistant'));
  bridge.dispose();
});

test('failed synthesis keeps verified written answer and does not repeat the action', async () => {
  let asked = 0;
  const events = [];
  const bridge = connectRecordedSpeech({
    agent: { ask: async () => { asked++; return { reply: 'Négy dal.' }; }, dispose() {} },
    transcribe: async () => 'Hány dal?', synthesize: async () => { throw new Error('offline'); },
    emit: e => events.push(e), closed: () => assert.fail('Text answer must remain available'),
  });
  bridge.start(); bridge.audio(Buffer.alloc(3200)); bridge.end();
  await until(() => events.some(e => e.type === 'turn_complete'));
  assert.equal(asked, 1);
  assert.ok(events.some(e => e.type === 'warning'));
  assert.ok(events.some(e => e.type === 'transcript' && e.text === 'Négy dal.'));
  bridge.dispose();
});

test('recording buffer is bounded and released on Stop', () => {
  const bridge = connectRecordedSpeech({ agent: { dispose() {} }, emit() {}, closed() {} });
  bridge.start(); bridge.audio(Buffer.alloc(480000));
  assert.throws(() => bridge.audio(Buffer.alloc(2)), /Invalid recording/);
  bridge.dispose(); assert.throws(() => bridge.start(), /active/);
});
