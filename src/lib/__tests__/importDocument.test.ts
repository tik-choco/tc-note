import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NoteMeta } from "../mistlib";

// importDocument only needs mistlib's note-creation surface, so mock it
// directly rather than mistlib's underlying wasm store (already covered by
// mistlib's own callers) — keeps this test focused on import logic.
const { saveNote, setNoteFolder } = vi.hoisted(() => ({
  saveNote: vi.fn(),
  setNoteFolder: vi.fn(),
}));

vi.mock("../mistlib", () => ({ saveNote, setNoteFolder }));

import { importDocument, importPdfViewerDocument, listPdfViewerDocuments } from "../importDocument";

const OCR_INDEX_KEY = "mist_ocr_markdown_index";
const TRANSLATED_INDEX_KEY = "mist_translated_markdown_index";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version for
// importDocument.ts's raw localStorage.getItem calls to hit.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function makeMeta(id: string, title: string): NoteMeta {
  return { id, title, cid: `cid-${id}`, updatedAt: Date.now(), favorite: false, preview: title, folderId: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", createMemoryStorage());
  saveNote.mockImplementation(async (id: string, title: string) => makeMeta(id, title));
});

describe("listPdfViewerDocuments", () => {
  it("returns an empty list when both indexes are empty", () => {
    expect(listPdfViewerDocuments()).toEqual([]);
  });

  it("lists a document with content, summary, and translations", () => {
    localStorage.setItem(
      OCR_INDEX_KEY,
      JSON.stringify({ "meeting.pdf": { content: "本文", updatedAt: 100, summary: "要約", summaryUpdatedAt: 200 } }),
    );
    localStorage.setItem(
      TRANSLATED_INDEX_KEY,
      JSON.stringify({ "meeting.pdf": { en: { content: "English", updatedAt: 300 }, ko: { content: "한국어", updatedAt: 150 } } }),
    );

    const docs = listPdfViewerDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({ pdfName: "meeting.pdf", hasSummary: true, languages: ["en", "ko"], updatedAt: 300 });
  });

  it("skips old-format entries that are bare CID strings", () => {
    localStorage.setItem(OCR_INDEX_KEY, JSON.stringify({ "old.pdf": "bafy123" }));
    localStorage.setItem(TRANSLATED_INDEX_KEY, JSON.stringify({ "old.pdf": { en: "bafy456" } }));

    expect(listPdfViewerDocuments()).toEqual([]);
  });

  it("returns an empty list when localStorage JSON is malformed", () => {
    localStorage.setItem(OCR_INDEX_KEY, "{not json");
    localStorage.setItem(TRANSLATED_INDEX_KEY, "{also not json");

    expect(listPdfViewerDocuments()).toEqual([]);
  });

  it("sorts documents by most recently updated first", () => {
    localStorage.setItem(
      OCR_INDEX_KEY,
      JSON.stringify({
        "older.pdf": { content: "a", updatedAt: 100 },
        "newer.pdf": { content: "b", updatedAt: 500 },
      }),
    );

    const docs = listPdfViewerDocuments();
    expect(docs.map((d) => d.pdfName)).toEqual(["newer.pdf", "older.pdf"]);
  });
});

describe("importPdfViewerDocument", () => {
  it("creates one note from content only", async () => {
    localStorage.setItem(OCR_INDEX_KEY, JSON.stringify({ "meeting.pdf": { content: "本文" } }));

    const result = await importPdfViewerDocument("meeting.pdf", null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toHaveLength(1);
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "meeting.pdf", "本文");
    expect(setNoteFolder).not.toHaveBeenCalled();
  });

  it("creates a summary note and translation notes alongside the main note", async () => {
    localStorage.setItem(
      OCR_INDEX_KEY,
      JSON.stringify({ "meeting.pdf": { content: "本文", summary: "要約本文" } }),
    );
    localStorage.setItem(
      TRANSLATED_INDEX_KEY,
      JSON.stringify({ "meeting.pdf": { en: { content: "English body", updatedAt: 1 }, ko: { content: "한국어 본문", updatedAt: 1 } } }),
    );

    const result = await importPdfViewerDocument("meeting.pdf", "folder-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toHaveLength(4);
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "meeting.pdf", "本文");
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "meeting.pdf (要約)", "要約本文");
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "meeting.pdf (en)", "English body");
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "meeting.pdf (ko)", "한국어 본문");
    expect(setNoteFolder).toHaveBeenCalledTimes(4);
    expect(result.notes.every((n) => n.folderId === "folder-1")).toBe(true);
  });

  it("skips old-format bare-CID entries and returns an error when nothing importable is found", async () => {
    localStorage.setItem(OCR_INDEX_KEY, JSON.stringify({ "old.pdf": "bafy123" }));
    localStorage.setItem(TRANSLATED_INDEX_KEY, JSON.stringify({ "old.pdf": { en: "bafy456" } }));

    const result = await importPdfViewerDocument("old.pdf", null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("noContent");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("returns an error for an unknown document", async () => {
    const result = await importPdfViewerDocument("missing.pdf", null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("noContent");
    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("importDocument / plain markdown", () => {
  it("creates one note titled after the filename", async () => {
    const result = await importDocument("My Notes.md", "# hello\nworld", null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toHaveLength(1);
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "My Notes", "# hello\nworld");
  });

  it("places the note into the given folder", async () => {
    await importDocument("notes.md", "content", "folder-9");
    expect(setNoteFolder).toHaveBeenCalledWith(expect.any(String), "folder-9");
  });
});

describe("importDocument / bibtex", () => {
  it("wraps the raw .bib contents in a fenced bibtex block, titled after the filename", async () => {
    const result = await importDocument("references.bib", "@article{doe2020, title = {X}}", null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toHaveLength(1);
    expect(saveNote).toHaveBeenCalledWith(
      expect.any(String),
      "references",
      "```bibtex\n@article{doe2020, title = {X}}\n```",
    );
  });

  it("places the note into the given folder", async () => {
    await importDocument("refs.bib", "@article{k1, title = {X}}", "folder-9");
    expect(setNoteFolder).toHaveBeenCalledWith(expect.any(String), "folder-9");
  });
});

describe("importDocument / unsupported file", () => {
  it("returns an error for unsupported extensions", async () => {
    const result = await importDocument("image.png", "binary-ish", null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupportedFormat");
    expect(saveNote).not.toHaveBeenCalled();
  });
});
