// Imports documents from tc-pdf-viewer, plus plain .md files, into tc-note
// as one or more notes. tc-pdf-viewer runs on the same origin and shares
// localStorage with tc-note, so its OCR/translation indexes are read
// directly rather than via a file-based bundle format. Reuses mistlib's own
// note-creation path (saveNote/setNoteFolder) rather than touching note
// storage directly.
//
// The OCR index additionally goes through the shared bus (sharedBus.ts, see
// protocol/docs/data-contracts/docs/SHARED_BUS.md): tc-pdf-viewer isn't
// (yet) content-addressing this index via mistlib, so the shared-bus record
// only carries a pointer back to the legacy key plus a change notification;
// the direct localStorage read below remains the source of truth and the
// fallback when the shared-bus record is absent or stale.
import { saveNote, setNoteFolder, type NoteMeta } from "./mistlib";
import { newId } from "./util";
import { readShared, subscribeShared } from "./sharedBus";

const OCR_INDEX_KEY = "mist_ocr_markdown_index";
const TRANSLATED_INDEX_KEY = "mist_translated_markdown_index";
const OCR_INDEX_TOPIC = "ocr-markdown-index";

type OcrEntry = { content?: string; updatedAt?: number; summary?: string; summaryUpdatedAt?: number; cid?: string };
type TranslationEntry = { content: string; updatedAt: number };

export type PdfViewerDocumentSummary = {
  pdfName: string;
  hasSummary: boolean;
  languages: string[];
  updatedAt: number;
};

// A single importable piece of a tc-pdf-viewer document (main content,
// summary, or one language's translation). `key` is a stable idempotency
// key used by autoImport.ts to dedupe across scans.
export type PdfViewerDocumentPart = {
  key: string;
  pdfName: string;
  title: string;
  content: string;
};

// Error codes rather than messages: the UI maps them to i18n keys
// ("import.noContent" etc.) at the toast call site.
export type ImportErrorCode = "noContent" | "unsupportedFormat";

export type ImportDocumentResult =
  | { ok: true; notes: NoteMeta[] }
  | { ok: false; error: ImportErrorCode };

async function createNote(title: string, content: string, folderId: string | null): Promise<NoteMeta> {
  const meta = await saveNote(newId(), title, content);
  if (folderId === null) return meta;
  setNoteFolder(meta.id, folderId);
  return { ...meta, folderId };
}

function readJsonRecord(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseOcrIndexRecord(raw: Record<string, unknown>): Record<string, OcrEntry> {
  const index: Record<string, OcrEntry> = {};
  for (const [pdfName, value] of Object.entries(raw)) {
    // Old format stored a bare CID string; those entries have no local
    // content to import, so they're skipped rather than resolved.
    if (typeof value === "string") continue;
    if (value === null || typeof value !== "object") continue;
    index[pdfName] = value as OcrEntry;
  }
  return index;
}

function readOcrIndex(): Record<string, OcrEntry> {
  // Prefer the shared-bus record (sharedBus.ts): tc-pdf-viewer publishes the
  // whole index snapshot there on every write, notifying subscribers. Fall
  // back to the legacy direct localStorage read if the record is absent or
  // malformed (e.g. an older tc-pdf-viewer build that predates the bus).
  const shared = readShared(OCR_INDEX_TOPIC);
  const sharedIndex = shared?.meta?.index;
  if (sharedIndex !== null && typeof sharedIndex === "object" && !Array.isArray(sharedIndex)) {
    return parseOcrIndexRecord(sharedIndex as Record<string, unknown>);
  }

  const raw = readJsonRecord(OCR_INDEX_KEY);
  return parseOcrIndexRecord(raw);
}

function readTranslatedIndex(): Record<string, Record<string, TranslationEntry>> {
  const raw = readJsonRecord(TRANSLATED_INDEX_KEY);
  const index: Record<string, Record<string, TranslationEntry>> = {};
  for (const [pdfName, langs] of Object.entries(raw)) {
    if (langs === null || typeof langs !== "object") continue;
    const entries: Record<string, TranslationEntry> = {};
    for (const [lang, value] of Object.entries(langs as Record<string, unknown>)) {
      // Old format stored a bare CID string per language; skip those.
      if (typeof value === "string") continue;
      if (value === null || typeof value !== "object") continue;
      const entry = value as Partial<TranslationEntry>;
      if (typeof entry.content !== "string") continue;
      entries[lang] = { content: entry.content, updatedAt: entry.updatedAt ?? 0 };
    }
    if (Object.keys(entries).length > 0) index[pdfName] = entries;
  }
  return index;
}

// Lists tc-pdf-viewer documents available to import, read directly from the
// shared localStorage (both apps run on the same origin).
export function listPdfViewerDocuments(): PdfViewerDocumentSummary[] {
  const ocrIndex = readOcrIndex();
  const translatedIndex = readTranslatedIndex();

  const pdfNames = new Set([...Object.keys(ocrIndex), ...Object.keys(translatedIndex)]);
  const results: PdfViewerDocumentSummary[] = [];

  for (const pdfName of pdfNames) {
    const ocrEntry = ocrIndex[pdfName];
    const hasContent = typeof ocrEntry?.content === "string" && ocrEntry.content.length > 0;
    const languages = Object.keys(translatedIndex[pdfName] ?? {});
    const hasSummary = typeof ocrEntry?.summary === "string" && ocrEntry.summary.length > 0;

    if (!hasContent && !hasSummary && languages.length === 0) continue;

    const updatedAt = Math.max(
      ocrEntry?.updatedAt ?? 0,
      ocrEntry?.summaryUpdatedAt ?? 0,
      ...languages.map((lang) => translatedIndex[pdfName]?.[lang]?.updatedAt ?? 0),
      0,
    );

    results.push({ pdfName, hasSummary, languages, updatedAt });
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Builds the fine-grained list of importable parts (main content, summary,
// per-language translations) for one pdfName, in the same order
// importPdfViewerDocument creates notes in. Shared by both that function and
// listPdfViewerDocumentParts() so the two never drift apart.
function partsForPdf(pdfName: string, ocrEntry: OcrEntry | undefined, translations: Record<string, TranslationEntry>): PdfViewerDocumentPart[] {
  const parts: PdfViewerDocumentPart[] = [];

  if (typeof ocrEntry?.content === "string" && ocrEntry.content.length > 0) {
    parts.push({ key: `pdf:${pdfName}:content`, pdfName, title: pdfName, content: ocrEntry.content });
  }

  if (typeof ocrEntry?.summary === "string" && ocrEntry.summary.length > 0) {
    parts.push({ key: `pdf:${pdfName}:summary`, pdfName, title: `${pdfName} (要約)`, content: ocrEntry.summary });
  }

  for (const [lang, translation] of Object.entries(translations)) {
    parts.push({ key: `pdf:${pdfName}:tr:${lang}`, pdfName, title: `${pdfName} (${lang})`, content: translation.content });
  }

  return parts;
}

// Lists every importable part (main content, summary, per-language
// translation) across all tc-pdf-viewer documents, each with a stable
// idempotency key — used by autoImport.ts to import fine-grained pieces one
// at a time and dedupe across scans.
export function listPdfViewerDocumentParts(): PdfViewerDocumentPart[] {
  const ocrIndex = readOcrIndex();
  const translatedIndex = readTranslatedIndex();
  const pdfNames = new Set([...Object.keys(ocrIndex), ...Object.keys(translatedIndex)]);

  const parts: PdfViewerDocumentPart[] = [];
  for (const pdfName of pdfNames) {
    parts.push(...partsForPdf(pdfName, ocrIndex[pdfName], translatedIndex[pdfName] ?? {}));
  }
  return parts;
}

// Imports one tc-pdf-viewer document (content + summary + translations) as
// one or more notes.
export async function importPdfViewerDocument(
  pdfName: string,
  folderId: string | null,
): Promise<ImportDocumentResult> {
  const ocrEntry = readOcrIndex()[pdfName];
  const translations = readTranslatedIndex()[pdfName] ?? {};
  const parts = partsForPdf(pdfName, ocrEntry, translations);

  const notes: NoteMeta[] = [];
  for (const part of parts) {
    notes.push(await createNote(part.title, part.content, folderId));
  }

  if (notes.length === 0) {
    return { ok: false, error: "noContent" };
  }

  return { ok: true, notes };
}

async function importMarkdown(fileName: string, text: string, folderId: string | null): Promise<ImportDocumentResult> {
  const title = fileName.replace(/\.md$/i, "").trim() || "Untitled";
  const note = await createNote(title, text, folderId);
  return { ok: true, notes: [note] };
}

// Wraps a raw .bib file's contents in a single ```bibtex fenced block, so it
// lands as one block that Block.tsx's isBibtexBlock branch renders directly
// (see bibtex.ts) rather than as unrendered plain text.
async function importBibtex(fileName: string, text: string, folderId: string | null): Promise<ImportDocumentResult> {
  const title = fileName.replace(/\.bib$/i, "").trim() || "Untitled";
  const content = `\`\`\`bibtex\n${text}\n\`\`\``;
  const note = await createNote(title, content, folderId);
  return { ok: true, notes: [note] };
}

// folderId: notes are placed in this folder (null = unfiled).
export async function importDocument(
  fileName: string,
  text: string,
  folderId: string | null,
): Promise<ImportDocumentResult> {
  if (fileName.toLowerCase().endsWith(".bib")) return importBibtex(fileName, text, folderId);
  if (fileName.toLowerCase().endsWith(".md")) return importMarkdown(fileName, text, folderId);
  return { ok: false, error: "unsupportedFormat" };
}

// Notifies `callback` whenever tc-pdf-viewer publishes a new OCR index
// (see sharedBus.ts). Callers typically re-fetch listPdfViewerDocuments()
// in response, e.g. to refresh an already-open import picker. Returns an
// unsubscribe function.
export function subscribePdfViewerDocumentsChanged(callback: () => void): () => void {
  return subscribeShared(OCR_INDEX_TOPIC, () => callback());
}
