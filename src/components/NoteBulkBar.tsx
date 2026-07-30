import { useRef, useState } from "preact/hooks";
import type { Folder } from "../lib/mistlib";
import { useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

const FOLDER_MENU_WIDTH = 200;

// Appears at the foot of the sidebar once two or more notes are selected
// (Shift/Ctrl+click in the note list) and carries the actions that only make
// sense in bulk. Single-note actions stay where they already are — the row's
// own star and kebab menu — so nothing moves for a user who never multi-selects.
export function NoteBulkBar(props: {
  count: number;
  folders: Folder[];
  /** Every selected note is already a favorite, so the star action un-favorites. */
  allFavorite: boolean;
  onMoveFolder: (folderId: string | null) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { count, folders, allFavorite, onMoveFolder, onToggleFavorite, onDelete, onClear } = props;
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  usePopoverDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  // position:fixed (so the sidebar's overflow can't clip it, as in NoteList's
  // row popover) and anchored *above* the bar — the bar sits at the very
  // bottom of the sidebar, so a menu dropping downwards would run off-screen.
  // Its left edge follows the bar, not the trigger, so the menu stays inside
  // the sidebar column instead of hanging over the editor.
  function toggleFolderMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect();
    if (!trigger || !bar) return;
    setMenuPos({
      bottom: Math.max(8, window.innerHeight - trigger.top + 6),
      left: Math.max(8, Math.min(bar.left, window.innerWidth - FOLDER_MENU_WIDTH - 8)),
    });
    setMenuOpen(true);
  }

  function handleMove(folderId: string | null) {
    setMenuOpen(false);
    onMoveFolder(folderId);
  }

  const favoriteLabel = t(allFavorite ? "noteList.bulk.unfavorite" : "noteList.bulk.favorite");

  return (
    <div class="note-bulk-bar" ref={barRef}>
      {/* aria-live so the count is announced as rows are added to the
          selection — the rows themselves are ordinary list items, not a
          listbox, so nothing else would report it. */}
      <span class="note-bulk-count" role="status" aria-live="polite">
        {t("noteList.selectedCount", { count })}
      </span>

      <div class="note-bulk-menu-wrap" ref={menuRef}>
        <button
          type="button"
          class="note-bulk-btn"
          ref={triggerRef}
          onClick={toggleFolderMenu}
          aria-label={t("noteList.bulk.move")}
          title={t("noteList.bulk.move")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Icon name="folder" size={16} />
        </button>
        {menuOpen && menuPos && (
          <div
            class="note-more-menu"
            role="menu"
            aria-label={t("noteList.bulk.move")}
            style={{ bottom: `${menuPos.bottom}px`, left: `${menuPos.left}px` }}
          >
            <div class="note-more-label">{t("noteList.moveToFolder")}</div>
            <button type="button" role="menuitem" class="note-more-item" onClick={() => handleMove(null)}>
              <span>{t("noteList.unfiled")}</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                class="note-more-item"
                onClick={() => handleMove(f.id)}
              >
                <span>{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        class={`note-bulk-btn${allFavorite ? " is-favorite" : ""}`}
        onClick={onToggleFavorite}
        aria-label={favoriteLabel}
        title={favoriteLabel}
      >
        <Icon name={allFavorite ? "star" : "star-outline"} size={16} />
      </button>

      <button
        type="button"
        class="note-bulk-btn note-bulk-btn--danger"
        onClick={onDelete}
        aria-label={t("noteList.bulk.delete")}
        title={t("noteList.bulk.delete")}
      >
        <Icon name="delete" size={16} />
      </button>

      <button
        type="button"
        class="note-bulk-btn"
        onClick={onClear}
        aria-label={t("noteList.bulk.clear")}
        title={t("noteList.bulk.clear")}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
