import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";

const DOCUMENT_XML_PATH = "word/document.xml";
const MAX_XML_PART_BYTES = 20 * 1024 * 1024;
const TRANSLATABLE_XML_PART = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$|^word\/glossary\/document\.xml$/;

export interface DocxData {
	/** The raw XML string of word/document.xml */
	documentXml: string;
	/** The JSZip instance with all other files intact */
	zip: JSZip;
}

export interface DocxXmlPart {
	path: string;
	xml: string;
}

export interface TranslatableDocxData {
	parts: DocxXmlPart[];
	zip: JSZip;
}

/**
 * Extract word/document.xml from a .docx file.
 * A .docx is a zip archive; we read the main document XML
 * and keep the zip open for later repacking.
 */
export async function extractDocxXml(inputPath: string): Promise<DocxData> {
	const buffer = await readFile(inputPath);
	const zip = await JSZip.loadAsync(buffer);

	const documentFile = zip.file(DOCUMENT_XML_PATH);
	if (!documentFile) {
		throw new Error(`No ${DOCUMENT_XML_PATH} found in ${inputPath}. Is this a valid .docx file?`);
	}

	const documentXml = await documentFile.async("string");
	if (Buffer.byteLength(documentXml, "utf8") > MAX_XML_PART_BYTES) {
		throw new Error("The uncompressed Word document XML exceeds the 20 MB safety limit.");
	}
	return { documentXml, zip };
}

/** Extract all user-visible WordprocessingML parts while retaining the package. */
export async function extractTranslatableDocxXml(inputPath: string): Promise<TranslatableDocxData> {
	const buffer = await readFile(inputPath);
	const zip = await JSZip.loadAsync(buffer);
	if (!zip.file(DOCUMENT_XML_PATH)) {
		throw new Error(`No ${DOCUMENT_XML_PATH} found in ${inputPath}. Is this a valid .docx file?`);
	}

	const paths = Object.keys(zip.files).filter((path) => TRANSLATABLE_XML_PART.test(path)).sort((a, b) => {
		if (a === DOCUMENT_XML_PATH) return -1;
		if (b === DOCUMENT_XML_PATH) return 1;
		return a.localeCompare(b);
	});
	const parts = await Promise.all(paths.map(async (path) => {
		const xml = await zip.file(path)!.async("string");
		if (Buffer.byteLength(xml, "utf8") > MAX_XML_PART_BYTES) {
			throw new Error(`${path} exceeds the 20 MB uncompressed safety limit.`);
		}
		return { path, xml };
	}));
	return { parts, zip };
}

/**
 * Replace word/document.xml in the zip and write the result to outputPath.
 */
export async function repackDocx(
	zip: JSZip,
	translatedXml: string,
	outputPath: string,
): Promise<void> {
	return repackDocxXmlParts(zip, [{ path: DOCUMENT_XML_PATH, xml: translatedXml }], outputPath);
}

export async function repackDocxXmlParts(
	zip: JSZip,
	parts: DocxXmlPart[],
	outputPath: string,
): Promise<void> {
	for (const part of parts) zip.file(part.path, part.xml);

	const output = await zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});

	await writeFile(outputPath, output);
}
