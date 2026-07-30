// Multi-select state for the sidebar note list (Shift+click for a range,
// Ctrl/Cmd+click to toggle one row). Kept as a pure reducer — no Preact, no
// DOM — because the modifier-key rules are the fiddly part and this project
// has no jsdom in its test setup; useNoteSelection.ts is the thin hook on top.
//
// Ranges are measured *within one list*. The sidebar renders several
// independent lists (favorites, one per folder, unfiled) and the same note can
// appear in two of them at once — a favorited note is listed both under
// Favorites and inside its folder — so there is no single global row order to
// slice. The anchor therefore records which list it was set in, and a
// Shift+click in a different list starts a new anchor instead of selecting an
// incoherent cross-section.

export type NoteSelectionAnchor = { listId: string; id: string };

export interface NoteSelectionState {
  /** Ids of every selected note, across all lists. */
  readonly ids: ReadonlySet<string>;
  /** The row a Shift+click range is measured from, or null before any click. */
  readonly anchor: NoteSelectionAnchor | null;
}

export interface NoteRowClick {
  /** Identifies the list the clicked row lives in — see the note above. */
  listId: string;
  /** That list's note ids, in display order. */
  orderedIds: readonly string[];
  id: string;
  /** Extend the selection from the anchor to this row. */
  shiftKey: boolean;
  /** Ctrl (Cmd on macOS): add/remove this row without disturbing the rest. */
  toggleKey: boolean;
}

export interface NoteRowClickResult {
  state: NoteSelectionState;
  /** True for a plain click: only unmodified clicks still open the note. */
  open: boolean;
}

export const EMPTY_NOTE_SELECTION: NoteSelectionState = { ids: new Set(), anchor: null };

export function applyNoteRowClick(
  state: NoteSelectionState,
  click: NoteRowClick,
): NoteRowClickResult {
  const { listId, orderedIds, id, shiftKey, toggleKey } = click;
  const index = orderedIds.indexOf(id);

  if (shiftKey && index >= 0) {
    const anchorIndex =
      state.anchor && state.anchor.listId === listId ? orderedIds.indexOf(state.anchor.id) : -1;
    // Nothing to measure from — the very first click of the session, or an
    // anchor set in another section (or on a row since filtered out by the
    // search box). Select just this row so the *next* Shift+click has an
    // anchor, but still don't open it: the user asked to select, not to
    // navigate.
    if (anchorIndex < 0) {
      return { state: { ids: new Set([id]), anchor: { listId, id } }, open: false };
    }
    const [lo, hi] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
    const range = orderedIds.slice(lo, hi + 1);
    // Ctrl+Shift+click keeps what was already selected and adds the range
    // (the file-manager convention); plain Shift+click replaces it. Either
    // way the anchor stays put, so sweeping the far end back and forth
    // re-measures from the same row rather than creeping along the list.
    const ids = toggleKey ? new Set([...state.ids, ...range]) : new Set(range);
    return { state: { ids, anchor: state.anchor }, open: false };
  }

  if (toggleKey) {
    const ids = new Set(state.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { state: { ids, anchor: { listId, id } }, open: false };
  }

  // Plain click: collapse to this one row (so it becomes the anchor) and open it.
  return { state: { ids: new Set([id]), anchor: { listId, id } }, open: true };
}

/** Ids a drag started on `id` should carry: the whole selection when the
 * dragged row is part of it, otherwise just that row — dragging an unselected
 * note must not silently move rows the user picked earlier. */
export function noteDragIds(state: NoteSelectionState, id: string): string[] {
  if (state.ids.size > 1 && state.ids.has(id)) return [...state.ids];
  return [id];
}

/** Drops ids that no longer exist (deleted elsewhere, imported over, etc.).
 * Returns the *same object* when nothing is stale, so the effect that calls
 * this on every note-list change doesn't churn state or re-render. */
export function pruneNoteSelection(
  state: NoteSelectionState,
  existingIds: ReadonlySet<string>,
): NoteSelectionState {
  const anchorStale = state.anchor !== null && !existingIds.has(state.anchor.id);
  const idsStale = [...state.ids].some((id) => !existingIds.has(id));
  if (!anchorStale && !idsStale) return state;
  return {
    ids: idsStale ? new Set([...state.ids].filter((id) => existingIds.has(id))) : state.ids,
    anchor: anchorStale ? null : state.anchor,
  };
}
