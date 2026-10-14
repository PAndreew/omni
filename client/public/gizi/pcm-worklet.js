import { PcmResampler } from './pcm-core.js';
class GiziCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new PcmResampler(sampleRate);
    this.active = true;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.active = false;
        this.resampler.flush(buffer => this.port.postMessage({ type: 'pcm', buffer }, [buffer]));
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (this.active && input) this.resampler.push(input, buffer => this.port.postMessage({ type: 'pcm', buffer }, [buffer]));
    return true;
  }
}
registerProcessor('gizi-capture', GiziCapture);
