"""Encode phonetic variants of hé zumi with the bundled English KWS tokenizer."""
import sys
from pathlib import Path
import sentencepiece as sp
root = Path(sys.argv[1])
tokenizer = sp.SentencePieceProcessor(model_file=str(root / 'bpe.model'))
with (root / 'beezy-keywords.txt').open('w', encoding='utf8') as output:
    for phrase in ['HEY ZUMI', 'HEY ZOOMIE', 'HAY ZOOMIE']:
        tokens = ' '.join(tokenizer.encode(phrase, out_type=str))
        output.write(f'{tokens} :1.5 #0.35 @HE_ZUMI\n')
