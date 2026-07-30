import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  createFolder,
  deleteFolder,
  deleteNote,
  listFolders,
  listNotes,
  restoreFolder,
  restoreNote,
  setFolderRoom,
  setNoteFolder,
  toggleFavorite,
  type Folder,
  type NoteMeta,
} from "./lib/mistlib";
import { extractOutline } from "./lib/outline";
import { joinBlocks, splitBlocks } from "./lib/blocks";
import { collectBibliography } from "./lib/bibtex";
import { isImeComposing, isNarrowScreen } from "./lib/util";
import { importDocument } from "./lib/importDocument";
import { startAutoImport } from "./lib/autoImport";
import { createNoteInboxActions, noteInboxTopic } from "./lib/noteInbox";
import { readShared, subscribeShared } from "./lib/sharedBus";
import { schedulePublishNoteDocIndex } from "./lib/noteDocExport";
import { createBlockActions } from "./lib/blockActions";
import { useNoteSession } from "./hooks/useNoteSession";
import { useNoteUrlSync } from "./hooks/useNoteUrlSync";
import { useToast } from "./hooks/useToast";
import { useCollab } from "./hooks/useCollab";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useLlmNet } from "./hooks/useLlmNet";
import { useAppSettings, useT } from "./hooks/useAppSettings";
import { Sidebar } from "./components/Sidebar";
import { EditorToolbar } from "./components/EditorToolbar";
import { BlockEditor } from "./components/BlockEditor";
import { OutlinePanel } from "./components/OutlinePanel";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { SettingsModal } from "./components/SettingsModal";
import { LlmChatPanel } from "./components/LlmChatPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { GlobalSearchModal } from "./components/GlobalSearchModal";
import { TranslateHoverLayer } from "./components/TranslateHoverLayer";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { AiQueueIndicator } from "./components/AiQueueIndicator";
import {
  markOnboardingDone,
  shouldShowOnboarding,
  subscribeOnboardingRequests,
} from "./lib/onboarding";
import "./app.css";

export function App() {
  const t = useT();
  const { language } = useAppSettings();
  const [notes, setNotes] = useState<NoteMeta[]>(() => listNotes());
  const [folders, setFolders] = useState<Folder[]>(() => listFolders());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(listFolders().map((f) => f.id)),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [query, setQuery] = useState("");
  // On narrow screens the sidebar is a fixed overlay (see layout.css), so it
  // starts closed there instead of covering the editor.
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen());
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const session = useNoteSession(notes, setNotes);
  const { toasts, showToast, dismissToast } = useToast();
  const llmSettings = useLlmSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding());

  // Settings' "show the setup guide again" button lives deep in the modal
  // tree, so it reaches this overlay through the onboarding request channel.
  useEffect(() => subscribeOnboardingRequests(() => setOnboardingOpen(true)), []);

  // Closing at any step counts as done — the wizard must never reappear
  // uninvited once dismissed.
  function closeOnboarding() {
    markOnboardingDone();
    setOnboardingOpen(false);
  }

  // The chat, review, and history panels all dock to the same right-edge
  // slot, so opening one closes the others rather than stacking panels
  // visually.
  function handleToggleChat() {
    setChatOpen((v) => {
      const next = !v;
      if (next) {
        setReviewOpen(false);
        setHistoryOpen(false);
      }
      return next;
    });
  }
  function handleToggleReview() {
    setReviewOpen((v) => {
      const next = !v;
      if (next) {
        setChatOpen(false);
        setHistoryOpen(false);
      }
      return next;
    });
  }
  function handleToggleHistory() {
    setHistoryOpen((v) => {
      const next = !v;
      if (next) {
        setChatOpen(false);
        setReviewOpen(false);
      }
      return next;
    });
  }
  const { activeId, title, content, blocksSnapshot, activeBlockIndex, setActiveBlockIndex } = session;

  // Current-state refs for callbacks that outlive a render (toast undo, the
  // []-deps shortcut effect) — their closures must not act on stale state.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const blocksSnapshotRef = useRef(blocksSnapshot);
  blocksSnapshotRef.current = blocksSnapshot;
  // Kept current every render so the []-deps note-inbox subscription below
  // (which can fire long after mount, well after activeId/dirty/etc. have
  // moved on) always opens notes through session's *current* selectNote
  // closure rather than a stale one from the render it was created in.
  const selectNoteRef = useRef(session.selectNote);
  selectNoteRef.current = session.selectNote;

  // Content from sibling apps (tc-pdf-viewer documents, tc-translate history)
  // lands in the notebook automatically — there is no import button for it
  // (see lib/autoImport.ts). The subscription outlives renders, so the toast
  // reads `t` through a ref to follow live language switches.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(
    () =>
      startAutoImport((count) => {
        setNotes(listNotes());
        setFolders(listFolders());
        schedulePublishNoteDocIndex();
        showToast(tRef.current("app.notesAutoImported", { count }));
      }),
    [],
  );

  // Files sent from tc-storage ("open in tc-note" on a text file preview)
  // land here via the shared bus's note-inbox topic (see lib/noteInbox.ts).
  // Best-effort: any failure to read/subscribe is logged and swallowed so it
  // never breaks startup, mirroring tc-storage's own appDriveInbox wiring.
  useEffect(() => {
    const noteInbox = createNoteInboxActions((created) => {
      setNotes(listNotes());
      setFolders(listFolders());
      schedulePublishNoteDocIndex();
      showToast(tRef.current("app.notesAutoImported", { count: created.length }));
      const newest = created[created.length - 1];
      if (newest) selectNoteRef.current(newest.id);
    });
    try {
      const existing = readShared(noteInboxTopic);
      if (existing) noteInbox.importFromInbox(existing);
    } catch (error) {
      console.warn("note-inbox: failed to read initial record", error);
    }
    try {
      return subscribeShared(noteInboxTopic, (record) => noteInbox.importFromInbox(record));
    } catch (error) {
      console.warn("note-inbox: failed to subscribe", error);
      return undefined;
    }
  }, []);

  // Full-index republish on every launch (see lib/noteDocExport.ts) covers
  // any note saved/deleted/restored while this side channel didn't exist yet
  // or tc-storage was mid-rollout, without needing a migration step.
  useEffect(() => {
    schedulePublishNoteDocIndex();
  }, []);

  useNoteUrlSync({ activeId, notes, selectNote: session.selectNote });

  // Block selection (Cmd/Ctrl+A, Shift+Click, copy/cut/delete). `selectionAnchorRef`
  // is the block a shift-click range is measured from — the last block that was
  // either active for editing or the target of a plain click.
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const selectionAnchorRef = useRef<number | null>(null);
  // The moving end of a keyboard (Shift+Arrow) block-range selection — the
  // block the range currently extends *to*, measured from selectionAnchorRef.
  const selectionFocusRef = useRef<number | null>(null);

  const activeMeta = notes.find((n) => n.id === activeId);
  const activeFolder = activeMeta?.folderId ? folders.find((f) => f.id === activeMeta.folderId) : undefined;
  const folderRoomId = activeFolder?.roomId ?? null;

  const collab = useCollab({
    title,
    blocksSnapshot,
    setTitle: session.setTitle,
    setBlocksSnapshot: session.setBlocksSnapshot,
    setContent: session.setContent,
    activeBlockIndex,
    noteId: activeId,
    onAdoptNoteId: session.openOrCreateNote,
    folderRoomId,
    onRoomContentReplaced: () => showToast(t("app.roomContentReplaced")),
  });

  // LLM chat transport: rides the collab room's session for the "network"
  // path, or calls the configured provider directly for "api". Bound to the
  // live session so it re-wires when the user joins/leaves/switches rooms.
  const llmNet = useLlmNet({
    session: collab.session,
    roomId: collab.roomId,
    connection: llmSettings.settings.connection,
    providerModeEnabled: llmSettings.settings.providerModeEnabled,
    networkRoomId: llmSettings.shared.network.roomId || null,
    resolved: llmSettings.resolved,
  });

  // Auto-join a room named in the URL (?room=xxx) on first load, e.g. after
  // opening an invite link. An accompanying `?note=<id>` names the sharer's
  // note. If it already exists locally, useNoteUrlSync's own deep-link
  // effect opens it; if it doesn't (first time seeing this shared note),
  // create it here *before* joining so content lands there from the start,
  // rather than waiting for the room's `meta` noteId to sync in and trigger
  // the adoption path in useCollab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room");
    const noteIdFromUrl = params.get("note");
    if (!roomId) return;
    const alreadyExists = noteIdFromUrl && notes.some((n) => n.id === noteIdFromUrl);
    console.debug("[collab] mount: URL invite link detected", {
      roomId,
      noteIdFromUrl,
      alreadyExists: !!alreadyExists,
    });
    const opened =
      noteIdFromUrl && !alreadyExists ? session.openOrCreateNote(noteIdFromUrl) : Promise.resolve();
    if (noteIdFromUrl && !alreadyExists) {
      console.debug("[collab] mount: opening/creating note from URL before join", { noteId: noteIdFromUrl });
    }
    // A malformed ?room= (edited by hand, truncated link, expired invite)
    // must not surface as an unhandled rejection — tell the user via toast
    // instead of leaving them silently un-joined.
    opened
      .then(() => {
        console.debug("[collab] mount: joining room from URL", { roomId });
        // Attach the room to the invited note explicitly: opening it (here or
        // via useNoteUrlSync's deep-link effect) is asynchronous, so the
        // active note may still be the previous one at this point, and the
        // room would otherwise be recorded against — and then dropped with —
        // whichever note that was.
        return collab.joinRoom(roomId, { forNoteId: noteIdFromUrl ?? undefined });
      })
      .catch((err) => {
        console.debug("[collab] mount: joinRoom from URL failed", { roomId, err });
        showToast(t("app.joinRoomFailed"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps `?room=` pointing at the room the user explicitly joined, and only
  // while they're on the note they joined it for — the `note` param moves
  // with the active note (see useNoteUrlSync), so a room left behind in the
  // URL would, on the next reload, be read back as an invite and pull an
  // unrelated note into it. Folder-derived rooms are deliberately left out:
  // they're re-derived from the folder on load anyway, and pinning one here
  // would outlive the folder's sharing being turned off.
  //
  // Declared after useNoteUrlSync's hook call so it reads a `location` that
  // already has the current `note` param when both update in one commit.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get("room");
    const next = collab.roomSource === "manual" ? collab.roomId : null;
    if (current === next) return;
    if (next) url.searchParams.set("room", next);
    else url.searchParams.delete("room");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [collab.roomId, collab.roomSource]);

  function handleCollabShare() {
    const roomId = collab.roomId ?? crypto.randomUUID();
    // Always a brand-new room (CollabButton only calls this when there's no
    // active room), so nobody else could have content for it yet — seed
    // immediately rather than waiting on the empty-room fallback.
    // join() failures already surface via collab.status ("error"), shown in
    // the popover — nothing further to do here besides not leaving an
    // unhandled rejection if the connection attempt fails.
    collab.joinRoom(roomId, { seed: true }).catch(() => {});
  }

  // Returns an error message to show inline in the popover, or null on success.
  async function handleCollabJoinById(roomId: string): Promise<string | null> {
    try {
      await collab.joinRoom(roomId);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : t("app.joinRoomFailed");
    }
  }

  function handleCollabLeave() {
    collab.leaveRoom();
  }

  // The browser tab shows the note being edited.
  useEffect(() => {
    document.title = title.trim() ? title : "TC Note";
  }, [title]);

  const outline = useMemo(() => extractOutline(content), [content]);
  // Note-wide citekey -> entry map, collected from every ```bibtex block in
  // the note (see collectBibliography) -- threaded down to each Block so a
  // "@key" mention anywhere becomes a hoverable reference when its entry
  // exists, regardless of which block defines it.
  const bibliography = useMemo(() => collectBibliography(blocksSnapshot), [blocksSnapshot]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q),
    );
  }, [notes, query]);

  const favorites = searched.filter((n) => n.favorite);
  const unfiledNotes = searched.filter((n) => n.folderId === null);

  function notesInFolder(folderId: string): NoteMeta[] {
    return searched.filter((n) => n.folderId === folderId);
  }

  function toggleFolderExpanded(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreateFolder(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    const folder = createFolder(name);
    setFolders(listFolders());
    setExpandedFolders((prev) => new Set(prev).add(folder.id));
    setNewFolderName("");
    setCreatingFolder(false);
  }

  function handleDeleteFolder(id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const affectedNoteIds = notes.filter((n) => n.folderId === id).map((n) => n.id);

    const result = deleteFolder(id);
    setFolders(result.folders);
    setNotes(result.notes.sort((a, b) => b.updatedAt - a.updatedAt));

    showToast(t("app.folderDeleted", { name }), () => {
      restoreFolder(folder);
      affectedNoteIds.forEach((noteId) => setNoteFolder(noteId, id));
      setFolders(listFolders());
      setNotes(listNotes());
    });
  }

  function handleMoveFolder(id: string, folderId: string | null) {
    setNotes(setNoteFolder(id, folderId).sort((a, b) => b.updatedAt - a.updatedAt));
  }

  function handleSetFolderRoom(folderId: string, roomId: string | null, isNew: boolean) {
    if (isNew && roomId) collab.markNextFolderJoinAsNew(roomId);
    setFolders(setFolderRoom(folderId, roomId));
  }

  function handleDelete(id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const meta = notes.find((n) => n.id === id);
    if (!meta) return;

    deleteNote(id);
    setNotes(listNotes());
    schedulePublishNoteDocIndex();
    if (id === activeId) session.startNewNote();

    showToast(t("app.noteDeleted", { name: name || t("pageTitle.placeholder") }), () => {
      restoreNote(meta);
      setNotes(listNotes());
      schedulePublishNoteDocIndex();
    });
  }

  function handleToggleFavorite(id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setNotes(toggleFavorite(id));
  }

  // Restoring a past version goes through the exact same setters a normal
  // edit uses (session.setContent/setBlocksSnapshot) rather than writing
  // straight to storage — so the change marks the session dirty, autosave
  // persists it as a brand-new version (making the restore itself
  // undoable via history), and — when a collab room is live — useCollab's
  // local-to-Yjs mirror effect (keyed off this same blocksSnapshot/title
  // state) picks it up and broadcasts it to peers exactly like any other
  // local edit. Nothing here needs to special-case the collab session.
  function handleRestoreVersion(markdown: string) {
    session.setBlocksSnapshot(splitBlocks(markdown));
    session.setContent(markdown);
    showToast(t("history.restored"));
  }

  function handleRestoreVersionFailed() {
    showToast(t("history.restoreFailed"));
  }

  // On narrow screens the sidebar overlays the editor, so opening or creating
  // a note should reveal the editor by closing it. Desktop keeps it open.
  function handleSelectNote(id: string) {
    session.selectNote(id);
    if (isNarrowScreen()) setSidebarOpen(false);
  }

  function handleNewNote() {
    session.startNewNote();
    if (isNarrowScreen()) setSidebarOpen(false);
  }

  // "+" on a folder header: start a note already destined for that folder, and
  // expand the folder so the user sees where it lands once they type.
  function handleNewNoteInFolder(folderId: string) {
    session.startNewNote(folderId);
    setExpandedFolders((prev) => new Set(prev).add(folderId));
    if (isNarrowScreen()) setSidebarOpen(false);
  }
  // The Alt+N effect below registers once ([] deps); going through a ref keeps
  // it calling the current closure instead of a first-render one whose stale
  // `dirty` would skip flushing unsaved edits.
  const handleNewNoteRef = useRef(handleNewNote);
  handleNewNoteRef.current = handleNewNote;

  async function handleImportFile(file: File) {
    const text = await file.text();
    const targetFolderId = activeMeta?.folderId ?? null;
    const result = await importDocument(file.name, text, targetFolderId);
    if (!result.ok) {
      showToast(t(`import.${result.error}`));
      return;
    }
    setNotes(listNotes());
    schedulePublishNoteDocIndex();
    showToast(t("app.notesImported", { count: result.notes.length }));
  }

  const blockActions = createBlockActions({
    content,
    blocksSnapshot,
    activeBlockIndex,
    setBlocksSnapshot: session.setBlocksSnapshot,
    setContent: session.setContent,
    setActiveBlockIndex,
  });

  // Selects every block between anchor and focus (inclusive), recording focus
  // as the moving end so a subsequent Shift+Arrow keeps extending from there.
  function selectBlockRange(anchor: number, focus: number) {
    const [lo, hi] = anchor <= focus ? [anchor, focus] : [focus, anchor];
    const range = new Set<number>();
    for (let i = lo; i <= hi; i++) range.add(i);
    selectionAnchorRef.current = anchor;
    selectionFocusRef.current = focus;
    setSelectedBlocks(range);
    setActiveBlockIndex(null);
  }

  function handleActivateBlock(index: number) {
    setSelectedBlocks(new Set());
    selectionAnchorRef.current = index;
    selectionFocusRef.current = index;
    setActiveBlockIndex(index);
  }

  // Arrow-up/down carried the caret out of `index` and into its neighbour —
  // re-anchor block selection on whichever block now holds the caret, so a
  // following Shift+Arrow extends from there rather than from wherever the
  // caret happened to be before.
  function handleNavigateBlock(index: number, direction: 1 | -1, column: number): boolean {
    if (!blockActions.focusAdjacentBlock(index, direction, column)) return false;
    selectionAnchorRef.current = index + direction;
    selectionFocusRef.current = index + direction;
    return true;
  }

  function handleShiftSelectBlock(index: number) {
    const anchor = selectionAnchorRef.current ?? activeBlockIndex ?? index;
    selectBlockRange(anchor, index);
  }

  // Shift+Down/Up pressed at the edge of the block being edited: leave text
  // editing and select this block plus the adjacent one, so the user can keep
  // extending a block selection across blocks with the keyboard.
  function handleExtendBlockSelection(index: number, direction: 1 | -1) {
    const focus = Math.max(0, Math.min(blocksSnapshot.length - 1, index + direction));
    selectBlockRange(index, focus);
  }

  function clearBlockSelection() {
    setSelectedBlocks(new Set());
  }

  function selectAllBlocks() {
    setActiveBlockIndex(null);
    setSelectedBlocks(new Set(blocksSnapshot.map((_, i) => i)));
    // Anchor at the top, focus at the bottom, so a following Shift+Up shrinks
    // the selection from the end rather than jumping somewhere arbitrary.
    selectionAnchorRef.current = 0;
    selectionFocusRef.current = Math.max(0, blocksSnapshot.length - 1);
  }

  async function copySelectedBlocksToClipboard(): Promise<void> {
    const sorted = Array.from(selectedBlocks).sort((a, b) => a - b);
    const text = sorted.map((i) => blocksSnapshot[i]).join("\n\n");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/markdown": new Blob([text], { type: "text/markdown" }),
          }),
        ]);
        return;
      }
    } catch {
      // fall through to plain-text copy
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard unavailable (permissions, insecure context, etc.) — no-op
    }
  }

  function deleteSelectedBlocks() {
    const count = selectedBlocks.size;
    if (count === 0) return;
    // Capture the removed blocks with their positions so the toast's undo can
    // re-insert just those blocks into the *current* state — restoring a whole
    // pre-delete snapshot would wipe edits made during the toast window, and
    // the toast can outlive a note switch, so undo must also refuse to write
    // into a different note (see the activeIdRef guard).
    const noteId = activeId;
    const removed = Array.from(selectedBlocks)
      .sort((a, b) => a - b)
      .map((i) => [i, blocksSnapshot[i]] as const);
    blockActions.removeBlocks(Array.from(selectedBlocks));
    clearBlockSelection();
    showToast(t("app.blocksDeleted", { count }), () => {
      if (activeIdRef.current !== noteId) return;
      const restored = blocksSnapshotRef.current.slice();
      for (const [index, block] of removed) {
        restored.splice(Math.min(index, restored.length), 0, block);
      }
      session.setBlocksSnapshot(restored);
      session.setContent(joinBlocks(restored));
    });
  }

  // Selection shortcuts, active only while no block is being edited (plain
  // Cmd/Ctrl+A while editing selects text natively; escalation to block
  // selection is handled inside Block.tsx's own keydown).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isImeComposing(e) && selectedBlocks.size > 0) {
        clearBlockSelection();
        return;
      }
      if (activeBlockIndex !== null) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        selectAllBlocks();
        return;
      }
      // Grow/shrink an existing block selection with the keyboard: Shift+Down
      // moves the focus end down a block, Shift+Up moves it up, re-deriving the
      // range from the fixed anchor (so pressing back up past the anchor flips
      // the selection to the other side, matching native text-selection feel).
      if (selectedBlocks.size > 0 && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const anchor = selectionAnchorRef.current ?? 0;
        const focus = selectionFocusRef.current ?? anchor;
        const nextFocus = Math.max(
          0,
          Math.min(blocksSnapshot.length - 1, focus + (e.key === "ArrowDown" ? 1 : -1)),
        );
        selectBlockRange(anchor, nextFocus);
        return;
      }
      if (selectedBlocks.size === 0) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        copySelectedBlocksToClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        e.preventDefault();
        copySelectedBlocksToClipboard().then(() => deleteSelectedBlocks());
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedBlocks();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlocks, activeBlockIndex, blocksSnapshot]);

  function handleEscalateSelectAll() {
    session.setActiveBlockIndex(null);
    selectAllBlocks();
  }

  // Clicking the empty canvas — beside or below the blocks, anywhere that
  // isn't a block, the title, or the outline — starts typing at the tail of
  // the note, like clicking into a document. Reuses the last block if it's
  // still empty, otherwise appends a fresh one.
  function handleCanvasClick(e: JSX.TargetedMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && !target.classList.contains("block-editor")) return;
    clearBlockSelection();
    const last = blocksSnapshot[blocksSnapshot.length - 1];
    if (last !== undefined && last.trim() === "") {
      setActiveBlockIndex(blocksSnapshot.length - 1);
    } else {
      blockActions.addBlockAtEnd();
    }
  }

  // Global shortcuts: Alt+N for a new note (Ctrl/Cmd+N is browser-reserved
  // and can't be intercepted), Ctrl/Cmd+K for the sidebar title filter, and
  // Ctrl/Cmd+Shift+F for the full-text global search. e.code identifies the
  // physical key — on macOS Option+N types a dead key, so e.key never says
  // "n" there; ctrl/meta are excluded so AltGr chords don't create notes.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        handleNewNoteRef.current();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      // Ctrl/Cmd+Shift+F: full-text global search. Use e.code so Shift's
      // uppercasing of e.key ("f" -> "F") and non-Latin layouts don't matter.
      if (e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        setGlobalSearchOpen(true);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      // Ctrl/Cmd+/: shortcuts cheat sheet. e.code so Shift/Alt variants
      // (which type other characters on some layouts) don't also trigger it.
      if (!e.shiftKey && !e.altKey && e.code === "Slash") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="layout">
      <Sidebar
        open={sidebarOpen}
        query={query}
        onQueryChange={setQuery}
        onNewNote={handleNewNote}
        onNewNoteInFolder={handleNewNoteInFolder}
        onImportFile={handleImportFile}
        hasAnyNotes={notes.length > 0}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        searchInputRef={searchInputRef}
        favorites={favorites}
        unfiledNotes={unfiledNotes}
        folders={folders}
        notesInFolder={notesInFolder}
        expandedFolders={expandedFolders}
        onToggleFolderExpanded={toggleFolderExpanded}
        creatingFolder={creatingFolder}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        onCreateFolder={handleCreateFolder}
        onCancelCreateFolder={() => {
          setNewFolderName("");
          setCreatingFolder(false);
        }}
        onStartCreateFolder={() => setCreatingFolder((v) => !v)}
        onDeleteFolder={handleDeleteFolder}
        onSetFolderRoom={handleSetFolderRoom}
        collabActiveFolderRoomId={collab.roomSource === "folder" ? folderRoomId : null}
        collabStatus={collab.status}
        manuallySharedNoteIds={collab.manuallySharedNoteIds}
        // Room membership is per note, so the connected room is always the
        // active note's (see useCollab's resolveTargetRoom).
        connectedNoteId={collab.status === "connected" ? activeId : null}
        activeId={activeId}
        onSelectNote={handleSelectNote}
        onDeleteNote={handleDelete}
        onToggleFavorite={handleToggleFavorite}
        onMoveFolder={handleMoveFolder}
      />

      {/* Scrim behind the mobile overlay sidebar — display:none above 768px
          (layout.css), so rendering it whenever open is desktop-safe. */}
      {sidebarOpen && <div class="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main class="editor-pane">
        <EditorToolbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          activeMeta={activeMeta}
          status={session.status}
          onToggleFavorite={handleToggleFavorite}
          activeId={activeId}
          collabStatus={collab.status}
          collabRoomId={collab.roomId}
          collabRoomSource={collab.roomSource}
          collabPeers={collab.peers}
          collabUser={collab.user}
          onCollabShare={handleCollabShare}
          onCollabLeave={handleCollabLeave}
          onCollabJoinById={handleCollabJoinById}
          onCollabUpdateUser={collab.updateUser}
          onOpenSettings={() => setSettingsOpen(true)}
          chatOpen={chatOpen}
          onToggleChat={handleToggleChat}
          reviewOpen={reviewOpen}
          onToggleReview={handleToggleReview}
          historyOpen={historyOpen}
          onToggleHistory={handleToggleHistory}
        />

        <div class="content-area" onClick={handleCanvasClick}>
          <BlockEditor
            titleInputRef={session.titleInputRef}
            title={title}
            onTitleChange={session.setTitle}
            blocks={blocksSnapshot}
            blockIds={collab.blockIds}
            activeBlockIndex={activeBlockIndex}
            onActivate={handleActivateBlock}
            onChange={blockActions.updateBlock}
            onDeactivate={blockActions.deactivateBlock}
            onAddBlock={blockActions.addBlockAtEnd}
            onSplit={blockActions.splitBlockAtCursor}
            onMergeIntoPrevious={blockActions.mergeIntoPrevious}
            onInsertAfter={blockActions.insertBlockAfter}
            onInsertBlocksAfter={blockActions.insertBlocksAfter}
            onFileTooLarge={(name) => showToast(t("blockEditor.fileTooLarge", { name }))}
            onEscalateSelectAll={handleEscalateSelectAll}
            onExtendBlockSelection={handleExtendBlockSelection}
            onNavigateBlock={handleNavigateBlock}
            selectedBlocks={selectedBlocks}
            onShiftSelectBlock={handleShiftSelectBlock}
            onClearSelection={clearBlockSelection}
            onReorder={blockActions.reorderBlock}
            collabPeers={collab.peers}
            bibliography={bibliography}
          />
          <OutlinePanel outline={outline} onJump={blockActions.jumpToOffset} />
        </div>

        <StatusBar
          activeMeta={activeMeta}
          markdownChars={content.length}
          collabPeers={collab.peers}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      </main>

      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Background AI tasks (review/chat) outlive their panels, so the
          indicator is a global overlay; clicking a task jumps back to its
          note and reopens the panel that owns that kind of task. */}
      <AiQueueIndicator
        onOpenTask={(task) => {
          if (task.noteId && task.noteId !== activeId && notes.some((n) => n.id === task.noteId)) {
            handleSelectNote(task.noteId);
          }
          if (task.kind === "review") {
            setReviewOpen(true);
            setChatOpen(false);
          } else if (task.kind === "chat") {
            setChatOpen(true);
            setReviewOpen(false);
          }
        }}
      />

      <TranslateHoverLayer net={llmNet} language={language} />

      {globalSearchOpen && (
        <GlobalSearchModal
          notes={notes}
          folders={folders}
          onOpenNote={(id) => {
            handleSelectNote(id);
            setGlobalSearchOpen(false);
          }}
          onClose={() => setGlobalSearchOpen(false)}
        />
      )}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {chatOpen && (
        <LlmChatPanel
          net={llmNet}
          noteId={activeId ?? undefined}
          noteTitle={title}
          noteText={content}
          onClose={() => setChatOpen(false)}
        />
      )}

      {reviewOpen && (
        <ReviewPanel
          net={llmNet}
          noteId={activeId ?? undefined}
          noteTitle={title}
          noteText={content}
          language={language}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {historyOpen && (
        <HistoryPanel
          noteId={activeId}
          status={session.status}
          onClose={() => setHistoryOpen(false)}
          onRestore={handleRestoreVersion}
          onRestoreFailed={handleRestoreVersionFailed}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={llmSettings.settings}
          shared={llmSettings.shared}
          onAddProvider={llmSettings.addProvider}
          onUpdateProvider={llmSettings.updateProvider}
          onRemoveProvider={llmSettings.removeProvider}
          onAddPreset={llmSettings.addPreset}
          onUpdatePreset={llmSettings.updatePreset}
          onRemovePreset={llmSettings.removePreset}
          onSetDefaultPresetId={llmSettings.setDefaultPresetId}
          onSetEmbeddingModel={llmSettings.setEmbeddingModel}
          onSetReasoningEffort={llmSettings.setReasoningEffort}
          onSetConnection={llmSettings.setConnection}
          onSetProviderModeEnabled={llmSettings.setProviderModeEnabled}
          onSetNetworkRoomId={llmSettings.setNetworkRoomId}
          net={llmNet}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {onboardingOpen && <OnboardingOverlay onClose={closeOnboarding} />}
    </div>
  );
}
