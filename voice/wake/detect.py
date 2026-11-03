"""Local streaming keyword spotting. Only keyword events leave this process."""
import argparse
import json
import signal
import subprocess
import sys
import time
from pathlib import Path
import numpy as np
import sherpa_onnx


def spotter(root):
    return sherpa_onnx.KeywordSpotter(
        tokens=str(root / 'tokens.txt'),
        encoder=str(next(root.glob('encoder-*.int8.onnx'))),
        decoder=str(next(root.glob('decoder-*.int8.onnx'))),
        joiner=str(next(root.glob('joiner-*.int8.onnx'))),
        keywords_file=str(root / 'beezy-keywords.txt'),
        num_threads=1, max_active_paths=4, num_trailing_blanks=2,
        keywords_score=1.5, keywords_threshold=0.35, provider='cpu',
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--source', default='@DEFAULT_SOURCE@')
    parser.add_argument('--pcm', help='Test a raw 16kHz mono signed-16-bit fixture, without recording')
    args = parser.parse_args()
    detector = spotter(Path(args.model))
    stream = detector.create_stream()
    capture = None
    if args.pcm:
        audio = open(args.pcm, 'rb')
    else:
        capture = subprocess.Popen(['parec', '--raw', '--format=s16le', '--rate=16000', '--channels=1', f'--device={args.source}'], stdout=subprocess.PIPE)
        audio = capture.stdout
    def stop(*_):
        if capture:
            capture.terminate()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(json.dumps({'type': 'ready'}), flush=True)
    last = 0
    try:
        while True:
            chunk = audio.read(3200)
            if not chunk:
                if not args.pcm:
                    raise RuntimeError('Microphone capture ended')
                break
            samples = np.frombuffer(chunk, dtype='<i2').astype(np.float32) / 32768
            stream.accept_waveform(16000, samples)
            while detector.is_ready(stream):
                detector.decode_stream(stream)
                keyword = detector.get_result(stream)
                if keyword:
                    detector.reset_stream(stream)
                    now = time.monotonic()
                    if now - last > 8:
                        print(json.dumps({'type': 'wake', 'keyword': keyword}), flush=True)
                        last = now
    finally:
        audio.close()
        if capture:
            capture.terminate()
            try:
                capture.wait(timeout=2)
            except subprocess.TimeoutExpired:
                capture.kill()


if __name__ == '__main__':
    main()
