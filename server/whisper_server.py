#!/usr/bin/env python3
"""
Whisper speech-to-text server (faster-whisper / CTranslate2).
Listens on http://127.0.0.1:8765 — accepts WAV POSTs, returns JSON transcript.
Multilingual: auto-detects English and Hungarian (and anything else).
Model is downloaded from HuggingFace on first run (~150 MB for 'base').
"""
import asyncio, json, os, sys, tempfile
from aiohttp import web
from faster_whisper import WhisperModel

MODEL_SIZE   = os.environ.get('WHISPER_MODEL', 'base')
CACHE_DIR    = os.path.join(os.path.dirname(__file__), 'models', 'whisper')
HOST, PORT   = '127.0.0.1', 8765

print(f'[Whisper] Loading model "{MODEL_SIZE}" (downloading if first run)…', flush=True)
model = WhisperModel(MODEL_SIZE, device='cpu', compute_type='int8',
                     download_root=CACHE_DIR)
print(f'[Whisper] Model ready — listening on {HOST}:{PORT}', flush=True)


async def inference(request):
    data = await request.post()

    audio_file = data.get('file')
    if not audio_file:
        return web.json_response({'error': 'No file'}, status=400)

    raw = audio_file.file.read()
    fname = getattr(audio_file, 'filename', 'audio.wav') or 'audio.wav'
    import os as _os; suffix = _os.path.splitext(fname)[1] or '.wav'

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(raw)
        tmp = f.name

    try:
        segments, info = model.transcribe(
            tmp,
            language=None,      # auto-detect (en / hu / …)
            beam_size=5,
            vad_filter=True,    # skip pure-silence segments
            initial_prompt="Hey Omni, okay Omni, hi Omni, hej Omni.",
        )
        text = ' '.join(s.text for s in segments).strip()
        print(f'[Whisper] [{info.language}] {text!r}', flush=True)
        return web.json_response({'text': text, 'language': info.language})
    except Exception as e:
        print(f'[Whisper] ERROR: {e}', flush=True)
        return web.json_response({'error': str(e)}, status=500)
    finally:
        os.unlink(tmp)


app = web.Application(client_max_size=50 * 1024 * 1024)
app.router.add_post('/inference', inference)

if __name__ == '__main__':
    web.run_app(app, host=HOST, port=PORT, print=None)
