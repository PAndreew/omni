// ─── Deepgram Streaming STT ───────────────────────────────────────────────────

import {
  createClient,
  LiveTranscriptionEvents,
  type LiveClient,
} from '@deepgram/sdk';

export interface DeepgramCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void;
  onSpeechStarted: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

export interface DeepgramSessionOptions {
  encoding?: 'auto' | 'linear16';
  sampleRate?: number;
}

export class DeepgramService {
  private client: ReturnType<typeof createClient>;

  constructor(apiKey: string) {
    this.client = createClient(apiKey);
  }

  openLiveSession(callbacks: DeepgramCallbacks, options: DeepgramSessionOptions = {}): LiveClient {
    const cfg: any = {
      model: 'nova-2',
      language: 'multi',
      interim_results: true,
      endpointing: 300,
      utterance_end_ms: 1000,
      vad_events: true,
      smart_format: true,
    };

    // Mobile Safari currently works with containerized chunks (auto detect).
    // Kiosk Chromium can explicitly send raw PCM for more reliable live STT.
    if (options.encoding === 'linear16') {
      cfg.encoding = 'linear16';
      cfg.sample_rate = options.sampleRate || 48000;
      cfg.channels = 1;
    }

    const live = this.client.listen.live(cfg);

    live.on(LiveTranscriptionEvents.Open, () => {
      console.log('[Deepgram] WebSocket open');
    });

    live.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alt = data?.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!text) return;
      const isFinal = data.speech_final === true;
      callbacks.onTranscript(text, isFinal);
    });

    live.on(LiveTranscriptionEvents.SpeechStarted, () => {
      callbacks.onSpeechStarted();
    });

    live.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      console.error('[Deepgram] Error:', err);
      callbacks.onError(err);
    });

    live.on(LiveTranscriptionEvents.Close, () => {
      console.log('[Deepgram] WebSocket closed');
      callbacks.onClose();
    });

    return live;
  }

  feedChunk(liveClient: LiveClient, chunk: Buffer): void {
    try {
      if ((liveClient as any).getReadyState() === 1) {
        liveClient.send(chunk);
      }
    } catch {
      // Ignore send errors — connection may be closing
    }
  }

  closeSession(liveClient: LiveClient): void {
    try {
      liveClient.finish();
    } catch {
      // Ignore
    }
  }
}
