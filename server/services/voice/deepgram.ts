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

export class DeepgramService {
  private client: ReturnType<typeof createClient>;

  constructor(apiKey: string) {
    this.client = createClient(apiKey);
  }

  openLiveSession(callbacks: DeepgramCallbacks): LiveClient {
    const live = this.client.listen.live({
      model: 'nova-2',
      language: 'multi',
      interim_results: true,
      endpointing: 300,
      utterance_end_ms: 1000,
      vad_events: true,
      smart_format: true,
    });

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
