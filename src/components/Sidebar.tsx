import { useRef, useState } from "preact/hooks";
import type { JSX, Ref } from "preact";
import type { Folder, NoteMeta } from "../lib/mistlib";
import type { CollabStatus } from "../lib/collab";
import { isImeComposing, UNFILED } from "../lib/util";
import { NoteList } from "./NoteList";
import { FolderShareButton } from "./FolderShareButton";
import { useT } from "../hooks/useAppSettings";
import { useSidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from "../hooks/useSidebarWidth";
import { Icon } from "./Icon";

const SIDEBAR_WIDTH_KEYBOARD_STEP = 16;

export function Sidebar(props: {
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onNewNote: () => void;
  onNewNoteInFolder: (folderId: string) => void;
  onImportFile: (file: File) => void;
  hasAnyNotes: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchInputRef: Ref<HTMLInputElement>;

  favorites: NoteMeta[];
  unfiledNotes: NoteMeta[];
  folders: Folder[];
  notesInFolder: (folderId: string) => NoteMeta[];
  expandedFolders: Set<string>;
  onToggleFolderExpanded: (id: string) => void;

  creatingFolder: boolean;
  newFolderName: string;
  onNewFolderNameChange: (name: string) => void;
  onCreateFolder: (e: JSX.TargetedEvent<HTMLFormElement>) => void;
  onCancelCreateFolder: () => void;
  onStartCreateFolder: () => void;
  onDeleteFolder: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onSetFolderRoom: (folderId: string, roomId: string | null, isNew: boolean) => void;
  /** The room id currently joined by the collab session (null if none) — lets a
   * folder's share popover tell whether it's the room actually connected right
   * now, vs. merely configured but not the active note's folder. */
  collabActiveRoomId: string | null;
  collabStatus: CollabStatus;

  activeId: string;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
}) {
  const {
    open,
    query,
    onQueryChange,
    onNewNote,
    onNewNoteInFolder,
    onImportFile,
    hasAnyNotes,
    searchOpen,
    onSearchOpenChange,
    searchInputRef,
    favorites,
    unfiledNotes,
    folders,
    notesInFolder,
    expandedFolders,
    onToggleFolderExpanded,
    creatingFolder,
    newFolderName,
    onNewFolderNameChange,
    onCreateFolder,
    onCancelCreateFolder,
    onStartCreateFolder,
    onDeleteFolder,
    onSetFolderRoom,
    collabActiveRoomId,
    collabStatus,
    activeId,
    onSelectNote,
    onDeleteNote,
    onToggleFavorite,
    onMoveFolder,
  } = props;

  const t = useT();
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Desktop drag-to-resize. The handle is a sibling of <aside> (not a child)
  // so it isn't clipped by the sidebar's overflow:hidden — see the CSS
  // comment in layout.css. Both read/write the same `width` state so the
  // handle's screen position always matches the sidebar's rendered edge.
  const { width: sidebarWidth, setWidth: setSidebarWidth, resetWidth: resetSidebarWidth } = useSidebarWidth();
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  function handleResizePointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>) {
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: sidebarWidth };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function handleResizePointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    setSidebarWidth(drag.startWidth + (e.clientX - drag.startX));
  }

  function endResizeDrag(e: JSX.TargetedPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setResizing(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    // Persist the final width — intermediate drag frames deliberately skip
    // localStorage writes so the drag itself stays lightweight.
    setSidebarWidth(drag.startWidth + (e.clientX - drag.startX), true);
  }

  function handleResizeKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_KEYBOARD_STEP, true);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_KEYBOARD_STEP, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSidebarWidth(SIDEBAR_WIDTH_MIN, true);
    } else if (e.key === "End") {
      e.preventDefault();
      setSidebarWidth(SIDEBAR_WIDTH_MAX, true);
    }
  }

  function dropHandlers(targetFolderId: string | null, key: string) {
    return {
      onDragOver: (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer?.types.includes("text/tc-note-id")) return;
        e.preventDefault();
        setDragOverTarget(key);
      },
      onDragLeave: () => setDragOverTarget((cur) => (cur === key ? null : cur)),
      onDrop: (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverTarget(null);
        const noteId = e.dataTransfer?.getData("text/tc-note-id");
        if (noteId) onMoveFolder(noteId, targetFolderId);
      },
    };
  }

  return (
    <>
      <aside
        class={`sidebar ${open ? "" : "sidebar--collapsed"} ${resizing ? "sidebar--resizing" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` }}
      >
      <div class="sidebar-header">
        {/* Compact tools row: a persistent search field (its ref is always
            mounted, so Ctrl+K can focus it) plus a quiet import icon button.
            The create action lives as a small "+" in the note list below
            instead of a big button here. */}
        <div class="sidebar-tools">
          <div class={`sidebar-search${searchOpen ? " sidebar-search--active" : ""}`}>
            <span class="sidebar-search-icon" aria-hidden="true">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={searchInputRef}
              type="search"
              class="sidebar-search-input"
              placeholder={t("sidebar.searchPlaceholder")}
              aria-label={t("sidebar.searchAriaLabel")}
              title={t("sidebar.searchTitle")}
              value={query}
              onInput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
              onFocus={() => onSearchOpenChange(true)}
              onBlur={() => !query && onSearchOpenChange(false)}
              onKeyDown={(e) => {
                // IME composition owns Escape (cancels the conversion).
                if (e.key === "Escape" && !isImeComposing(e)) {
                  onQueryChange("");
                  onSearchOpenChange(false);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          </div>
          <button
            type="button"
            class="icon-btn sidebar-tool-btn"
            onClick={() => importInputRef.current?.click()}
            title={t("sidebar.import")}
            aria-label={t("sidebar.import")}
          >
            <Icon name="upload" />
          </button>
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept=".md,.bib"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = "";
            if (file) onImportFile(file);
          }}
        />
      </div>

      <div class="sidebar-scroll">
        {!hasAnyNotes && (
          <div class="sidebar-empty-hint">
            <span class="sidebar-empty-hint-icon" aria-hidden="true">
              <Icon name="edit" size={22} />
            </span>
            <p>{t("sidebar.emptyHint")}</p>
          </div>
        )}

        {favorites.length > 0 && (
          <div class="note-section">
            <h3>{t("sidebar.favorites")}</h3>
            <NoteList
              notes={favorites}
              folders={folders}
              activeId={activeId}
              onSelect={onSelectNote}
              onDelete={onDeleteNote}
              onToggleFavorite={onToggleFavorite}
              onMoveFolder={onMoveFolder}
            />
          </div>
        )}

        <div class="note-section">
          <div class="note-section-header">
            <h3>{t("sidebar.notebooks")}</h3>
            <button
              type="button"
              class="folder-add-btn"
              onClick={onStartCreateFolder}
              aria-label={t("sidebar.addFolder")}
              title={t("sidebar.addFolder")}
            >
              <Icon name="add" size={16} />
            </button>
          </div>

          {creatingFolder && (
            <form class="folder-create-form" onSubmit={onCreateFolder}>
              <input
                autoFocus
                placeholder={t("sidebar.newFolderPlaceholder")}
                value={newFolderName}
                onInput={(e) => onNewFolderNameChange((e.target as HTMLInputElement).value)}
                onBlur={() => !newFolderName.trim() && onCancelCreateFolder()}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !isImeComposing(e)) onCancelCreateFolder();
                }}
              />
            </form>
          )}

          {folders.map((folder) => {
            const notesHere = notesInFolder(folder.id);
            const expanded = expandedFolders.has(folder.id);
            return (
              <div class="folder-group" key={folder.id}>
                <div
                  class={`folder-header ${dragOverTarget === folder.id ? "drop-target" : ""}`}
                  {...dropHandlers(folder.id, folder.id)}
                >
                  {/* A real button so expand/collapse works from the keyboard;
                      share/delete stay siblings so they aren't nested inside it. */}
                  <button
                    type="button"
                    class="folder-toggle"
                    onClick={() => onToggleFolderExpanded(folder.id)}
                    aria-expanded={expanded}
                  >
                    <span class="folder-arrow">
                      <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                    </span>
                    <span class="folder-icon">
                      <Icon name="folder" size={15} />
                    </span>
                    <span class="folder-name">{folder.name}</span>
                    <span class="folder-count">{notesHere.length}</span>
                  </button>
                  <button
                    type="button"
                    class="folder-note-add"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewNoteInFolder(folder.id);
                    }}
                    aria-label={t("sidebar.newNoteInFolder")}
                    title={t("sidebar.newNoteInFolder")}
                  >
                    <Icon name="add" size={15} />
                  </button>
                  <FolderShareButton
                    folder={folder}
                    onSetRoom={onSetFolderRoom}
                    liveStatus={folder.roomId && folder.roomId === collabActiveRoomId ? collabStatus : null}
                  />
                  <button
                    type="button"
                    class="delete folder-delete"
                    onClick={(e) => onDeleteFolder(folder.id, folder.name, e)}
                    aria-label={t("sidebar.deleteFolder")}
                    title={t("sidebar.deleteFolder")}
                  >
                    <Icon name="delete" size={15} />
                  </button>
                </div>
                {expanded && (
                  <NoteList
                    notes={notesHere}
                    folders={folders}
                    activeId={activeId}
                    onSelect={onSelectNote}
                    onDelete={onDeleteNote}
                    onToggleFavorite={onToggleFavorite}
                    onMoveFolder={onMoveFolder}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div
          class={`note-section note-section--grow ${dragOverTarget === UNFILED ? "drop-target" : ""}`}
          {...dropHandlers(null, UNFILED)}
        >
          <div class="note-section-header">
            <h3>{t("sidebar.unfiledSection")}</h3>
            {/* Primary create action — new notes are unfiled by default, so a
                quiet "+" here is semantically the right home. Always visible
                (not hover-gated) so it stays discoverable and tappable. */}
            <button
              type="button"
              class="folder-add-btn"
              onClick={onNewNote}
              aria-label={t("sidebar.newNote")}
              title={t("sidebar.newNote")}
            >
              <Icon name="add" size={16} />
            </button>
          </div>
          <NoteList
            notes={unfiledNotes}
            folders={folders}
            activeId={activeId}
            onSelect={onSelectNote}
            onDelete={onDeleteNote}
            onToggleFavorite={onToggleFavorite}
            onMoveFolder={onMoveFolder}
          />
        </div>
      </div>
      </aside>
      {/* Sibling of <aside>, not a child — the sidebar has overflow:hidden
          (needed for the collapse-width transition to clip cleanly), which
          would clip a handle straddling its edge. Absolutely positioned in
          .layout instead, at the sidebar's current right edge. Hidden while
          collapsed (nothing to resize) and hidden on mobile via CSS. */}
      {open && (
        <div
          class={`sidebar-resize-handle ${resizing ? "sidebar-resize-handle--active" : ""}`}
          style={{ left: `${sidebarWidth}px` }}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("sidebar.resizeHandle")}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
          onDblClick={resetSidebarWidth}
          onKeyDown={handleResizeKeyDown}
        />
      )}
    </>
  );
}
