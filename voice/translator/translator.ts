import {
  createAgentSession,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createIsolatedResourceLoader } from "./isolated-resource-loader";
import type { ParagraphChunk } from "./xml-chunker";

const MAX_RETRIES = 2;
const TRANSLATION_SYSTEM_PROMPT = `You are a professional document translator.
Translate only human-readable text while preserving every structural marker exactly.
Input contains paragraphs wrapped in <p id="n">...</p>.
Return every input paragraph exactly once with the same id and order.
Preserve every [RUN:n]...[/RUN:n] pair and every [TAG:n] marker exactly. Translate text inside RUN markers when present; otherwise translate the paragraph text directly. Never alter marker IDs, marker order, or XML entities such as &amp;, &lt;, and &gt;.
Do not add explanations, Markdown, or commentary. Output only the translated <p> elements.`;

type DisposableSession = { dispose(): void; abort(): Promise<void> };
const activeSessions = new Set<DisposableSession>();

export function terminateAllTranslationSessions() {
  for (const session of activeSessions) {
    void session.abort().catch(() => undefined);
    session.dispose();
  }
  activeSessions.clear();
}

export interface TranslateOptions {
  targetLanguage: string;
  sourceLanguage?: string;
  modelRuntime: ModelRuntime;
  concurrency: number;
  batchSize: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

function markers(text: string) {
  return [...text.matchAll(/\[(?:\/?RUN|TAG):(\d+)\]/g)].map((match) => match[0]);
}

export function hasMatchingMarkers(original: string, translated: string) {
  return JSON.stringify(markers(original)) === JSON.stringify(markers(translated));
}

async function translateBatch(batch: ParagraphChunk[], options: TranslateOptions) {
  if (batch.length === 0) return { translated: [] as ParagraphChunk[], missing: [] as ParagraphChunk[] };

  const { session } = await createAgentSession({
    modelRuntime: options.modelRuntime,
    resourceLoader: createIsolatedResourceLoader(TRANSLATION_SYSTEM_PROMPT),
    noTools: "all",
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } }),
  });
  activeSessions.add(session);

  let resultText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      resultText += event.assistantMessageEvent.delta;
    }
  });
  const abort = () => void session.abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  const languageHint = options.sourceLanguage ? ` from ${options.sourceLanguage}` : "";
  const input = batch.map((chunk) => `<p id="${chunk.index}">${chunk.simplifiedText}</p>`).join("\n");

  try {
    await session.prompt(`Translate${languageHint} to ${options.targetLanguage}:\n\n${input}`);
    if (session.agent.state.errorMessage) throw new Error(session.agent.state.errorMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onProgress?.(`A translation batch failed and will be retried: ${message}`);
    return { translated: [] as ParagraphChunk[], missing: batch };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    unsubscribe();
    activeSessions.delete(session);
    session.dispose();
  }

  const translated: ParagraphChunk[] = [];
  const found = new Set<number>();
  const paragraphPattern = /<p id="(\d+)">([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = paragraphPattern.exec(resultText)) !== null) {
    const id = Number.parseInt(match[1], 10);
    const original = batch.find((chunk) => chunk.index === id);
    const text = match[2].trim();
    if (original && text && !found.has(id) && hasMatchingMarkers(original.simplifiedText, text)) {
      translated.push({ ...original, simplifiedText: text });
      found.add(id);
    }
  }
  return { translated, missing: batch.filter((chunk) => !found.has(chunk.index)) };
}

export async function translateChunksInParallel(chunks: ParagraphChunk[], options: TranslateOptions) {
  const results: ParagraphChunk[] = new Array(chunks.length);
  const translatable = chunks.filter((chunk) => chunk.hasText && chunk.simplifiedText.trim());
  for (const chunk of chunks.filter((candidate) => !translatable.includes(candidate))) results[chunk.index] = chunk;

  let pending = translatable;
  for (let attempt = 0; attempt <= MAX_RETRIES && pending.length > 0; attempt++) {
    if (options.signal?.aborted) throw new Error("Translation aborted");
    const batchSize = attempt === 0 ? options.batchSize : 1;
    const batches: ParagraphChunk[][] = [];
    for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize));
    if (attempt > 0) options.onProgress?.(`Retrying ${pending.length} sections (${attempt}/${MAX_RETRIES})…`);

    const missing: ParagraphChunk[] = [];
    for (let index = 0; index < batches.length; index += options.concurrency) {
      const group = batches.slice(index, index + options.concurrency);
      const settled = await Promise.all(group.map((batch) => translateBatch(batch, options)));
      for (const result of settled) {
        for (const chunk of result.translated) results[chunk.index] = chunk;
        missing.push(...result.missing);
      }
      options.onProgress?.(`Translated ${translatable.length - missing.length - batches.slice(index + options.concurrency).flat().length} of ${translatable.length} sections…`);
    }
    pending = missing;
  }

  if (pending.length > 0) throw new Error(`${pending.length} document sections could not be translated without damaging formatting markers.`);
  return results;
}
