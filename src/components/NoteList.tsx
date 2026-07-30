import { useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { noteShareState, type Folder, type NoteMeta, type NoteShareState } from "../lib/mistlib";
import type { Language } from "../lib/appSettings";
import { formatRelativeTime, formatTime } from "../lib/util";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import type { NoteSelection } from "../hooks/useNoteSelection";
import { Icon } from "./Icon";

export function NoteList(props: {
  /** Identifies this list among the sidebar's several (favorites, one per
   * folder, unfiled) so Shift+click measures its range within one of them —
   * see lib/noteSelection.ts. */
  listId: string;
  notes: NoteMeta[];
  folders: Folder[];
  activeId: string;
  /** Notes shared by explicit user action this session — see useCollab. */
  manuallySharedNoteIds: ReadonlySet<string>;
  /** The note whose room the collab session is connected to right now, if any. */
  connectedNoteId: string | null;
  selection: NoteSelection;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
}) {
  const {
    listId,
    notes,
    folders,
    activeId,
    manuallySharedNoteIds,
    connectedNoteId,
    selection,
    onSelect,
    onDelete,
    onToggleFavorite,
    onMoveFolder,
  } = props;
  const t = useT();
  const { language } = useAppSettings();
  // The display order a Shift+click range is sliced from. Computed once per
  // render rather than per row — every row hands the same array back to the
  // selection reducer on click.
  const orderedIds = useMemo(() => notes.map((n) => n.id), [notes]);
  if (notes.length === 0) {
    return <p class="note-list-empty">{t("noteList.empty")}</p>;
  }
  return (
    <ul class="note-list">
      {notes.map((n) => (
        <NoteRow
          key={n.id}
          note={n}
          folders={folders}
          active={n.id === activeId}
          selected={selection.selectedIds.has(n.id)}
          listId={listId}
          orderedIds={orderedIds}
          selection={selection}
          shareState={noteShareState(n, folders, manuallySharedNoteIds, connectedNoteId)}
          language={language}
          t={t}
          onSelect={onSelect}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onMoveFolder={onMoveFolder}
        />
      ))}
    </ul>
  );
}

// One note row plus its "more actions" popover (move-to-folder + delete).
// The popover's open/position state is local to the row so opening one
// closes any other via usePopoverDismiss's outside-click handling.
function NoteRow(props: {
  note: NoteMeta;
  folders: Folder[];
  active: boolean;
  selected: boolean;
  listId: string;
  orderedIds: readonly string[];
  selection: NoteSelection;
  shareState: NoteShareState;
  language: Language;
  t: (key: Parameters<ReturnType<typeof useT>>[0], params?: Record<string, string | number>) => string;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
}) {
  const {
    note: n,
    folders,
    active,
    selected,
    listId,
    orderedIds,
    selection,
    shareState,
    language,
    t,
    onSelect,
    onDelete,
    onToggleFavorite,
    onMoveFolder,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  usePopoverDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  // The popover renders position:fixed — the sidebar's overflow-y:auto
  // scroll container would otherwise clip an absolutely-positioned one — so
  // anchor it to the trigger's (or the right-clicked row's) viewport rect,
  // clamped to the screen edges like FolderShareButton's popover.
  function openMenuAt(rect: DOMRect) {
    const width = 200;
    setMenuPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
    setMenuOpen(true);
  }

  function handleMoreClick(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) openMenuAt(rect);
  }

  function handleContextMenu(e: JSX.TargetedMouseEvent<HTMLLIElement>) {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.currentTarget.getBoundingClientRect());
  }

  function handleMove(folderId: string | null, e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen(false);
    onMoveFolder(n.id, folderId);
  }

  function handleDelete(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen(false);
    onDelete(n.id, n.title, e);
  }

  // Row-level click is the single entry point for selection: a plain click
  // still opens the note, Shift extends a range and Ctrl/Cmd toggles this row
  // (neither opens anything — see lib/noteSelection.ts).
  function handleRowClick(e: JSX.TargetedMouseEvent<HTMLElement>) {
    if (selection.onRowClick(listId, orderedIds, n.id, e)) onSelect(n.id);
  }

  const currentFolderId = n.folderId ?? null;

  return (
    <li
      key={n.id}
      class={`${active ? "active" : ""} ${selected ? "is-selected" : ""}`}
      draggable
      onDragStart={(e) => {
        if (!e.dataTransfer) return;
        // Always advertise the single dragged note, so drop targets that only
        // know the original one-note contract keep working; a drag that picks
        // up a whole selection adds the full list alongside it.
        e.dataTransfer.setData("text/tc-note-id", n.id);
        const ids = selection.dragIds(n.id);
        if (ids.length > 1) e.dataTransfer.setData("text/tc-note-ids", JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
      }}
      // Shift+click would otherwise start a native text-selection sweep across
      // the sidebar; the row is a click target, so there's nothing to lose by
      // suppressing it (unmodified clicks keep their default behavior).
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      // Row-level click keeps the whole row (padding, gaps between the
      // controls) opening the note as before; the controls stopPropagation.
      onClick={handleRowClick}
      onContextMenu={handleContextMenu}
    >
      <button
        type="button"
        class={`favorite-toggle${n.favorite ? " is-favorite" : ""}`}
        onClick={(e) => onToggleFavorite(n.id, e)}
        aria-label={t("noteList.favoriteToggle")}
        title={t("noteList.favoriteToggle")}
      >
        <Icon name={n.favorite ? "star" : "star-outline"} size={15} />
      </button>
      {/* A real button so notes open from the keyboard. It deliberately has no
          click handler of its own: Enter/Space on a button dispatches a click
          that bubbles to the row, so one handler covers both, and a mouse
          click can't be counted twice (which would toggle Ctrl+click's
          selection straight back off). */}
      <button
        type="button"
        class="note-summary"
        aria-current={active ? "true" : undefined}
      >
        <span class="note-title-row">
          <span class="note-title">{n.title || t("pageTitle.placeholder")}</span>
          {/* Sharing marker: a dot, not a word, so a list of mostly-local
              notes stays quiet — the state it stands for is in the tooltip
              and the aria-label. Absent entirely for a purely local note,
              which is what makes the shared ones scannable. */}
          {shareState !== "local" && (
            <span
              class={`note-share note-share--${shareState}`}
              title={t(`noteList.shareState.${shareState}`)}
              aria-label={t(`noteList.shareState.${shareState}`)}
              role="img"
            />
          )}
          <span class="note-time" title={formatTime(n.updatedAt, language)}>{formatRelativeTime(n.updatedAt, language)}</span>
        </span>
        <span class="note-preview">{n.preview}</span>
      </button>
      <div class="note-more" ref={menuRef}>
        <button
          type="button"
          class="note-more-btn"
          ref={triggerRef}
          onClick={handleMoreClick}
          aria-label={t("noteList.moreActions")}
          title={t("noteList.moreActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Icon name="more-vert" size={16} />
        </button>
        {menuOpen && menuPos && (
          <div
            class="note-more-menu"
            role="menu"
            aria-label={t("noteList.moreActions")}
            style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="note-more-label">{t("noteList.moveToFolder")}</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={currentFolderId === null}
              class="note-more-item"
              disabled={currentFolderId === null}
              onClick={(e) => handleMove(null, e)}
            >
              {currentFolderId === null && <Icon name="check" size={14} />}
              <span>{t("noteList.unfiled")}</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitemradio"
                aria-checked={currentFolderId === f.id}
                class="note-more-item"
                disabled={currentFolderId === f.id}
                onClick={(e) => handleMove(f.id, e)}
              >
                {currentFolderId === f.id && <Icon name="check" size={14} />}
                <span>{f.name}</span>
              </button>
            ))}
            <div class="note-more-divider" />
            <button type="button" role="menuitem" class="note-more-item note-more-item--danger" onClick={handleDelete}>
              {t("noteList.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
