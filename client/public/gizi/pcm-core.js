// Streaming box-filter resampler. Keeps fractional phase between render quanta,
// so 44.1 kHz and 48 kHz browser inputs both produce exactly 16 kHz PCM.
export class PcmResampler {
  constructor(inputRate, outputRate = 16000, frameSize = 1600) {
    if (inputRate < outputRate) throw new Error('Unsupported microphone sample rate');
    this.ratio = inputRate / outputRate;
    this.remaining = this.ratio;
    this.sum = 0;
    this.frame = new Int16Array(frameSize);
    this.index = 0;
  }
  push(samples, emit) {
    for (const sample of samples) {
      let available = 1;
      while (available > 1e-8) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining < 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.sum = 0; this.remaining = this.ratio;
          if (this.index === this.frame.length) {
            const buffer = this.frame.buffer;
            // postMessage transfers detach the emitted buffer synchronously.
            // Allocate the next frame before emit can zero frame.length.
            this.frame = new Int16Array(this.frame.length); this.index = 0;
            emit(buffer);
          }
        }
      }
    }
  }
  flush(emit) { if (this.index) emit(this.frame.slice(0, this.index).buffer); this.index = 0; }
}
