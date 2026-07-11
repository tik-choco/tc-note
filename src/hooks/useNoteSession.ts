import { useEffect, useRef, useState } from "preact/hooks";
import { listNotes, loadNote, saveNote, setNoteFolder, type NoteMeta } from "../lib/mistlib";
import { schedulePublishNoteDocIndex } from "../lib/noteDocExport";
import { splitBlocks } from "../lib/blocks";
import { newId } from "../lib/util";

const AUTOSAVE_DELAY_MS = 800;
const SAVED_INDICATOR_MS = 2000;
const TITLE_MAX_LEN = 80;

function titleFromContent(markdown: string): string {
  const firstLine = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!firstLine) return "Untitled";
  const stripped = firstLine.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "");
  return stripped.slice(0, TITLE_MAX_LEN) || "Untitled";
}

// Owns the "currently open note" editing session: which note is active, its
// title/content/block state, and autosave. Notes list ownership stays with
// the caller since folders/favorites also mutate it.
export function useNoteSession(notes: NoteMeta[], setNotes: (n: NoteMeta[]) => void) {
  const [activeId, setActiveId] = useState<string>(() => newId());
  // Empty title = "auto" — the sidebar name is derived from the first content
  // line at save time, and the editor shows the "Untitled" placeholder.
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [blocksSnapshot, setBlocksSnapshot] = useState<string[]>([""]);
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null);
  // Internal tag, not display text — "", "saving", "loading", "saved", or
  // "save-error:<detail>"/"load-error:<detail>". EditorToolbar maps this to a
  // translated string at render time.
  const [status, setStatus] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const savedRef = useRef<{ id: string; title: string; content: string }>({
    id: activeId,
    title: "",
    content: "",
  });
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savedIndicatorTimerRef = useRef<number | undefined>(undefined);
  // A note created "inside a folder" (a folder's + button) isn't persisted
  // until the user types — so remember the target folder and apply it the
  // moment that note first saves. Keeps the "never persist an empty note" rule
  // intact while still filing the note where the user asked.
  const pendingFolderRef = useRef<{ id: string; folderId: string } | null>(null);

  async function flushSave(id: string, t: string, c: string) {
    const saved = savedRef.current;
    if (saved.id === id && saved.title === t && saved.content === c) return;
    // The user never named the note — fall back to the note's own first
    // line so the sidebar shows something meaningful instead of a pile of
    // indistinguishable "Untitled" entries.
    const effectiveTitle = t.trim() === "" ? titleFromContent(c) : t;
    try {
      setStatus("saving");
      await saveNote(id, effectiveTitle, c);
      savedRef.current = { id, title: t, content: c };
      // Land the note in its intended folder on its first save (see
      // pendingFolderRef) before we read the list back, so it appears filed.
      const pending = pendingFolderRef.current;
      if (pending && pending.id === id) {
        setNoteFolder(id, pending.folderId);
        pendingFolderRef.current = null;
      }
      setNotes(listNotes());
      // Mirrors this note into tc-storage's view of the world (see
      // lib/noteDocExport.ts) — best-effort and debounced, so it never
      // delays or interferes with the save itself.
      schedulePublishNoteDocIndex();
      setDirty(false);
      setStatus("saved");
      // Auto-dismiss the "saved" indicator so it doesn't linger as visual noise.
      window.clearTimeout(savedIndicatorTimerRef.current);
      savedIndicatorTimerRef.current = window.setTimeout(() => {
        setStatus((prev) => (prev === "saved" ? "" : prev));
      }, SAVED_INDICATOR_MS);
    } catch (err) {
      setStatus(`save-error:${String(err)}`);
    }
  }

  // Autosave: debounce edits, then persist via mistlib's storage_add. Never
  // persist a brand-new, still-empty note just because it exists — only
  // once the user has actually typed something.
  useEffect(() => {
    window.clearTimeout(saveTimerRef.current);
    const saved = savedRef.current;
    if (saved.id === activeId && saved.title === title && saved.content === content) return;
    const alreadyPersisted = notes.some((n) => n.id === activeId);
    if (content.trim() === "" && !alreadyPersisted) return;
    setDirty(true);
    saveTimerRef.current = window.setTimeout(() => {
      flushSave(activeId, title, content);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, title, content]);

  async function switchTo(id: string, initialTitle: string, initialContent: string) {
    window.clearTimeout(saveTimerRef.current);
    if (dirty) await flushSave(activeId, title, content);

    setActiveId(id);
    setTitle(initialTitle);
    setContent(initialContent);
    setBlocksSnapshot(splitBlocks(initialContent));
    setActiveBlockIndex(null);
    savedRef.current = { id, title: initialTitle, content: initialContent };
    setDirty(false);
  }

  async function selectNote(id: string) {
    if (id === activeId) return;
    setStatus("loading");
    const meta = notes.find((n) => n.id === id);
    try {
      const markdown = await loadNote(id);
      // If the stored title is just what we would auto-derive anyway (or a
      // legacy "Untitled"), reopen it in "auto" mode so it keeps tracking
      // the first content line instead of freezing at an old value.
      const stored = meta?.title ?? "";
      const auto = stored === "" || stored === "Untitled" || stored === titleFromContent(markdown);
      await switchTo(id, auto ? "" : stored, markdown);
      setStatus("");
    } catch (err) {
      setStatus(`load-error:${String(err)}`);
    }
  }

  // Opens `id` if a local note with that id already exists, otherwise
  // creates one starting from `initialContent`/`initialTitle` — used to bind
  // the editor to a specific note id that came from outside this session
  // (a collab room's shared note id, a `?note=` deep link) rather than the
  // locally-generated `newId()` this hook otherwise starts with.
  async function openOrCreateNote(id: string, initialTitle = "", initialContent = "") {
    if (id === activeId) return;
    const exists = notes.some((n) => n.id === id);
    if (exists) {
      await selectNote(id);
    } else {
      await switchTo(id, initialTitle, initialContent);
    }
  }

  function startNewNote(folderId: string | null = null) {
    const id = newId();
    // Remember the destination folder (if any) so the first autosave files it.
    pendingFolderRef.current = folderId ? { id, folderId } : null;
    switchTo(id, "", "");
    setStatus("");
    // Jump straight into naming the note; the input is empty (placeholder
    // shows "Untitled"), so typing immediately names it.
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
  }

  return {
    activeId,
    title,
    setTitle,
    content,
    setContent,
    blocksSnapshot,
    setBlocksSnapshot,
    activeBlockIndex,
    setActiveBlockIndex,
    status,
    titleInputRef,
    selectNote,
    startNewNote,
    openOrCreateNote,
  };
}
