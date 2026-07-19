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
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";

const OCR_INDEX_KEY = "mist_ocr_markdown_index";
const TRANSLATED_INDEX_KEY = "mist_translated_markdown_index";
const OCR_INDEX_TOPIC = "ocr-markdown-index";

type OcrEntry = { content?: string; updatedAt?: number; summary?: string; summaryUpdatedAt?: number; cid?: string };
type TranslationEntry = { content?: string; cid?: string; updatedAt?: number };

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
    // Oldest format stored a bare CID string. It's still a CID, so normalize
    // it to { cid } and let it flow through the same cid dual-read path
    // (resolveEntryContent below) as the current { cid, updatedAt, summary? }
    // format, rather than skipping it.
    const entry = typeof value === "string" ? { cid: value } : value;
    if (entry === null || typeof entry !== "object") continue;
    index[pdfName] = entry as OcrEntry;
  }
  return index;
}

// Resolves one entry's body: prefer the inline `content` (old format, or
// already-resolved), else fetch the CID'd body from mistlib (new format —
// see contract A in protocol/docs/data-contracts/docs/SHARED_BUS.md / the
// storage-fix dual-read rules). Never throws: a storage_get failure is
// logged and treated as "no content" so one bad entry can't break the whole
// index.
async function resolveEntryContent(content: string | undefined, cid: string | undefined): Promise<string | undefined> {
  if (typeof content === "string") return content;
  if (!cid) return undefined;
  try {
    await ensureMistNode();
    const bytes = await storage_get(cid);
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.warn(`importDocument: failed to resolve cid "${cid}"`, error);
    return undefined;
  }
}

async function readOcrIndex(): Promise<Record<string, OcrEntry>> {
  // Prefer the shared-bus record (sharedBus.ts): tc-pdf-viewer publishes an
  // index snapshot there on every write, notifying subscribers. Two shapes
  // are supported (dual-read): the old format inlines the whole index in
  // `meta.index`; the new format (contract A) keeps `meta` small and
  // content-addresses the index snapshot itself via `cid`. Fall back to the
  // legacy direct localStorage read if the record is absent or malformed
  // (e.g. an older tc-pdf-viewer build that predates the bus).
  const shared = readShared(OCR_INDEX_TOPIC);
  const sharedIndex = shared?.meta?.index;
  let record: Record<string, OcrEntry> | null = null;

  if (sharedIndex !== null && sharedIndex !== undefined && typeof sharedIndex === "object" && !Array.isArray(sharedIndex)) {
    record = parseOcrIndexRecord(sharedIndex as Record<string, unknown>);
  } else if (shared?.cid) {
    try {
      await ensureMistNode();
      const bytes = await storage_get(shared.cid);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parseOcrIndexRecord(parsed as Record<string, unknown>);
      }
    } catch (error) {
      console.warn("importDocument: failed to resolve shared ocr-markdown-index cid", error);
    }
  }

  if (record === null) {
    record = parseOcrIndexRecord(readJsonRecord(OCR_INDEX_KEY));
  }

  for (const entry of Object.values(record)) {
    entry.content = await resolveEntryContent(entry.content, entry.cid);
  }
  return record;
}

async function readTranslatedIndex(): Promise<Record<string, Record<string, TranslationEntry>>> {
  const raw = readJsonRecord(TRANSLATED_INDEX_KEY);
  const index: Record<string, Record<string, TranslationEntry>> = {};
  for (const [pdfName, langs] of Object.entries(raw)) {
    if (langs === null || typeof langs !== "object") continue;
    const entries: Record<string, TranslationEntry> = {};
    for (const [lang, value] of Object.entries(langs as Record<string, unknown>)) {
      // Oldest format stored a bare CID string per language. It's still a
      // CID, so normalize it to { cid } and let it flow through the same
      // dual-read path below as the current { cid, updatedAt } format,
      // rather than skipping it.
      const entry = typeof value === "string" ? { cid: value } : value;
      if (entry === null || typeof entry !== "object") continue;
      const parsed = entry as Partial<TranslationEntry>;
      const content = await resolveEntryContent(
        typeof parsed.content === "string" ? parsed.content : undefined,
        typeof parsed.cid === "string" ? parsed.cid : undefined,
      );
      if (content === undefined) continue;
      entries[lang] = { content, updatedAt: parsed.updatedAt ?? 0 };
    }
    if (Object.keys(entries).length > 0) index[pdfName] = entries;
  }
  return index;
}

// Lists tc-pdf-viewer documents available to import, read directly from the
// shared localStorage (both apps run on the same origin).
export async function listPdfViewerDocuments(): Promise<PdfViewerDocumentSummary[]> {
  const ocrIndex = await readOcrIndex();
  const translatedIndex = await readTranslatedIndex();

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
    // readTranslatedIndex only ever inserts entries whose content resolved
    // successfully (dual-read), so this is always defined here.
    if (typeof translation.content !== "string") continue;
    parts.push({ key: `pdf:${pdfName}:tr:${lang}`, pdfName, title: `${pdfName} (${lang})`, content: translation.content });
  }

  return parts;
}

// Lists every importable part (main content, summary, per-language
// translation) across all tc-pdf-viewer documents, each with a stable
// idempotency key — used by autoImport.ts to import fine-grained pieces one
// at a time and dedupe across scans.
export async function listPdfViewerDocumentParts(): Promise<PdfViewerDocumentPart[]> {
  const ocrIndex = await readOcrIndex();
  const translatedIndex = await readTranslatedIndex();
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
  const ocrEntry = (await readOcrIndex())[pdfName];
  const translations = (await readTranslatedIndex())[pdfName] ?? {};
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
