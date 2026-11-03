import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { extractTranslatableDocxXml, repackDocxXmlParts } from "./docx";
import { chunkParagraphs, reconstructXml, replaceTagsWithIds } from "./xml-chunker";
import { translateChunksInParallel } from "./translator";

export interface TranslateDocxOptions {
  inputPath: string;
  outputPath: string;
  targetLanguage: string;
  sourceLanguage?: string;
  concurrency?: number;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

function validateXml(xml: string) {
  const stack: string[] = [];
  const pattern = /<(\/?)([a-zA-Z0-9:]+)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) throw new Error(`Translated document produced malformed XML near </${name}>.`);
  }
  if (stack.length > 0) throw new Error("Translated document produced malformed XML.");
}

export async function translateDocx(options: TranslateDocxOptions) {
  const concurrency = Math.min(Math.max(options.concurrency ?? 3, 1), 5);
  const batchSize = Math.min(Math.max(options.batchSize ?? 30, 1), 50);
  options.onProgress?.("Reading Word document parts…");
  const { parts, zip } = await extractTranslatableDocxXml(options.inputPath);
  const prepared = parts.map((part) => {
    const { chunks, idTagMap } = replaceTagsWithIds(chunkParagraphs(part.xml));
    return { ...part, chunks, idTagMap };
  });
  const count = prepared.reduce(
    (total, part) => total + part.chunks.filter((chunk) => chunk.hasText).length,
    0,
  );

  if (count === 0) {
    options.onProgress?.("No translatable text found; preserving the original document.");
    await repackDocxXmlParts(zip, parts, options.outputPath);
    return { outputPath: options.outputPath, chunksTranslated: 0 };
  }

  options.onProgress?.(`Preparing ${count} sections across ${parts.length} document parts…`);
  const modelRuntime = await ModelRuntime.create();
  const translatedParts = [];
  for (const [partIndex, part] of prepared.entries()) {
    const partCount = part.chunks.filter((chunk) => chunk.hasText).length;
    if (partCount === 0) {
      translatedParts.push({ path: part.path, xml: part.xml });
      continue;
    }
    options.onProgress?.(`Translating ${part.path} (${partIndex + 1}/${prepared.length})…`);
    const translated = await translateChunksInParallel(part.chunks, {
      targetLanguage: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      concurrency,
      batchSize,
      modelRuntime,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    const xml = reconstructXml(part.xml, translated, part.idTagMap);
    validateXml(xml);
    translatedParts.push({ path: part.path, xml });
  }

  options.onProgress?.("Rebuilding the Word document…");
  await repackDocxXmlParts(zip, translatedParts, options.outputPath);
  options.onProgress?.("Translation complete.");
  return { outputPath: options.outputPath, chunksTranslated: count };
}
