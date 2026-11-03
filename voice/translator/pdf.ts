import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { translateChunksInParallel } from "./translator";

const execute = promisify(execFile);
const pdfBlockSchema = z.object({
  id: z.string(),
  page: z.number().int().nonnegative(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  text: z.string().min(1),
  fontSize: z.number().positive(),
  color: z.number().int().nonnegative(),
  bold: z.boolean(),
});
const pdfManifestSchema = z.object({
  version: z.literal(1),
  pageCount: z.number().int().positive().max(100),
  blocks: z.array(pdfBlockSchema).max(2000),
});

function workerPaths() {
  const root = process.env.OMNI_TRANSLATOR_ROOT ?? process.cwd();
  return {
    python: process.env.OMNI_TRANSLATOR_PYTHON ?? path.join(root, ".venv", "bin", "python"),
    worker: path.join(root, "python", "pdf_processor.py"),
  };
}

async function runWorker(args: string[]) {
  const { python, worker } = workerPaths();
  try {
    await execute(python, [worker, ...args], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const message = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim().split("\n")[0] : String(error);
    throw new Error(message || "PDF processor failed.");
  }
}

function encodeText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function decodeText(text: string) {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

export async function translatePdf(options: {
  inputPath: string;
  outputPath: string;
  workingDirectory: string;
  targetLanguage: string;
  sourceLanguage?: string;
  onProgress?: (message: string) => void;
}) {
  const manifestPath = path.join(options.workingDirectory, "pdf-manifest.json");
  const translationsPath = path.join(options.workingDirectory, "pdf-translations.json");
  options.onProgress?.("Extracting positioned PDF text…");
  await runWorker(["extract", options.inputPath, manifestPath]);
  const manifest = pdfManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  if (manifest.blocks.length === 0) throw new Error("No selectable text was found. Scanned PDFs are not supported yet.");

  options.onProgress?.(`Translating ${manifest.blocks.length} positioned text blocks…`);
  const modelRuntime = await ModelRuntime.create();
  const chunks = manifest.blocks.map((block, index) => ({ index, simplifiedText: encodeText(block.text), hasText: true }));
  const translated = await translateChunksInParallel(chunks, {
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    concurrency: 3,
    batchSize: 30,
    modelRuntime,
    onProgress: options.onProgress,
  });
  const output = manifest.blocks.map((block, index) => ({ id: block.id, text: decodeText(translated[index].simplifiedText) }));
  await fs.writeFile(translationsPath, JSON.stringify(output), { mode: 0o600 });

  options.onProgress?.("Replacing text while preserving page layout…");
  await runWorker(["render", options.inputPath, manifestPath, translationsPath, options.outputPath]);
  options.onProgress?.("PDF translation complete.");
  return { outputPath: options.outputPath, chunksTranslated: manifest.blocks.length };
}
