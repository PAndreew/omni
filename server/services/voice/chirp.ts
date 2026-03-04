// ─── Google Cloud TTS (Chirp 3 HD) ───────────────────────────────────────────

import textToSpeech from '@google-cloud/text-to-speech';

const PREFERRED_VOICES = [
  'en-US-Chirp3-HD-Aoede',
  'en-US-Chirp3-HD-Puck',
  'en-US-Chirp-HD-O',
  'en-US-Neural2-C',  // fallback
];

// Split on sentence boundaries to enable streaming TTS while LLM is still going
function splitIntoChunks(text: string, maxLen = 300): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  // Split on sentence-ending punctuation
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export class ChirpService {
  private client: textToSpeech.TextToSpeechClient;
  private voiceName: string | null = null;

  constructor() {
    // Auth via GOOGLE_APPLICATION_CREDENTIALS env var
    this.client = new textToSpeech.TextToSpeechClient();
  }

  private async resolveVoice(): Promise<string> {
    if (this.voiceName) return this.voiceName;
    try {
      const [resp] = await this.client.listVoices({ languageCode: 'en-US' });
      const available = (resp.voices ?? []).map((v: any) => v.name as string);
      console.log('[Chirp] Available en-US voices (first 10):', available.slice(0, 10));
      for (const pref of PREFERRED_VOICES) {
        if (available.includes(pref)) {
          this.voiceName = pref;
          console.log('[Chirp] Selected voice:', pref);
          return pref;
        }
      }
    } catch (err) {
      console.warn('[Chirp] Could not list voices:', err);
    }
    // Hard fallback
    this.voiceName = 'en-US-Neural2-C';
    return this.voiceName;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
    const voice = await this.resolveVoice();
    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: voice,
      },
      audioConfig: { audioEncoding: 'MP3' },
    });
    if (signal?.aborted) throw new Error('aborted');
    return response.audioContent as Buffer;
  }

  // Synthesize long text in sentence-boundary chunks, calling onChunk for each
  async synthesizeStreaming(
    text: string,
    signal: AbortSignal,
    onChunk: (audio: Buffer, isLast: boolean) => void,
  ): Promise<void> {
    const chunks = splitIntoChunks(text);
    for (let i = 0; i < chunks.length; i++) {
      if (signal.aborted) return;
      const audio = await this.synthesize(chunks[i], signal);
      if (signal.aborted) return;
      onChunk(audio, i === chunks.length - 1);
    }
  }
}
