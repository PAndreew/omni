---
name: omni-document-translator
description: Translate DOCX and text-based PDF documents through Omni's formatting-preserving translator. Use when asked to translate a Word document or PDF into another language.
---

# Omni document translator

Confirm the input path and target language. Documents are sent to the configured Pi model provider; obtain consent when documents contain sensitive information. Scanned PDFs are unsupported; uploads are limited to 20 MB.

Run the bundled script (resolve its path relative to this skill directory):

```bash
node scripts/translate.mjs /absolute/input.docx Hungarian /absolute/output.docx
```

An optional fourth argument specifies source language. The script reads the local Gizi access-key file without printing it, starts a job, polls progress, and saves the translated document. Never print or include that key in messages. Do not overwrite an existing output. Translation may take several minutes and incur model costs. Report worker errors honestly; do not claim success until the output is downloaded. Existing home-applets jobs are not imported.
