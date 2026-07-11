import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { Folder, NoteMeta } from "../lib/mistlib";
import type { Language } from "../lib/appSettings";
import { formatRelativeTime, formatTime } from "../lib/util";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

export function NoteList(props: {
  notes: NoteMeta[];
  folders: Folder[];
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
}) {
  const { notes, folders, activeId, onSelect, onDelete, onToggleFavorite, onMoveFolder } = props;
  const t = useT();
  const { language } = useAppSettings();
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
  language: Language;
  t: (key: Parameters<ReturnType<typeof useT>>[0], params?: Record<string, string | number>) => string;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onMoveFolder: (id: string, folderId: string | null) => void;
}) {
  const { note: n, folders, active, language, t, onSelect, onDelete, onToggleFavorite, onMoveFolder } = props;
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

  const currentFolderId = n.folderId ?? null;

  return (
    <li
      key={n.id}
      class={active ? "active" : ""}
      draggable
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/tc-note-id", n.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      }}
      // Row-level click keeps the whole row (padding, gaps between the
      // controls) opening the note as before; the controls stopPropagation.
      onClick={() => onSelect(n.id)}
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
      {/* A real button so notes open from the keyboard. */}
      <button
        type="button"
        class="note-summary"
        onClick={() => onSelect(n.id)}
        aria-current={active ? "true" : undefined}
      >
        <span class="note-title-row">
          <span class="note-title">{n.title || t("pageTitle.placeholder")}</span>
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
