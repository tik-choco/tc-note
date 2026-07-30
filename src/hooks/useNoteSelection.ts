// Binds lib/noteSelection.ts's pure reducer to Preact state and the two bits
// of environment it can't own itself: Escape to clear, and pruning ids that
// vanished from the note list. Everything about *what* a modified click means
// lives in the reducer, not here.
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  applyNoteRowClick,
  EMPTY_NOTE_SELECTION,
  noteDragIds,
  pruneNoteSelection,
  type NoteSelectionState,
} from "../lib/noteSelection";
import { isImeComposing } from "../lib/util";

/** The modifier flags a row click carries — a structural subset of MouseEvent,
 * so callers can pass the event straight through. */
export interface NoteClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface NoteSelection {
  selectedIds: ReadonlySet<string>;
  count: number;
  /** Handle a click on a note row. Returns true when the caller should also
   * open the note — i.e. for a plain, unmodified click. */
  onRowClick: (
    listId: string,
    orderedIds: readonly string[],
    id: string,
    modifiers: NoteClickModifiers,
  ) => boolean;
  /** Note ids a drag starting on `id` should move (see noteDragIds). */
  dragIds: (id: string) => string[];
  clear: () => void;
}

export function useNoteSelection(existingIds: ReadonlySet<string>): NoteSelection {
  const [state, setState] = useState<NoteSelectionState>(EMPTY_NOTE_SELECTION);

  // A note deleted (here or by a sibling tab) must not linger in the selection
  // and have bulk actions fired at it. pruneNoteSelection returns the same
  // object when nothing is stale, so this is a no-op on most note-list changes.
  useEffect(() => {
    setState((prev) => pruneNoteSelection(prev, existingIds));
  }, [existingIds]);

  // Escape clears, matching block selection in the editor. Registered once and
  // updating through the functional setter, so it never holds a stale set.
  // Deliberately not preventDefault/stopPropagation: the sidebar search box
  // also treats Escape as "clear", and both clearing at once is the expected
  // result of pressing it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || isImeComposing(e)) return;
      // An open note popover (a row's kebab menu, or the bulk bar's move-to-
      // folder menu) owns Escape first — backing out of a menu must not also
      // throw away the selection the menu was about to act on. usePopoverDismiss
      // closes it on the same keystroke, so the next Escape reaches us.
      if (document.querySelector(".note-more-menu")) return;
      setState((prev) => (prev.ids.size > 0 ? EMPTY_NOTE_SELECTION : prev));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onRowClick = useCallback(
    (
      listId: string,
      orderedIds: readonly string[],
      id: string,
      modifiers: NoteClickModifiers,
    ): boolean => {
      const result = applyNoteRowClick(state, {
        listId,
        orderedIds,
        id,
        shiftKey: modifiers.shiftKey,
        toggleKey: modifiers.ctrlKey || modifiers.metaKey,
      });
      setState(result.state);
      return result.open;
    },
    [state],
  );

  const dragIds = useCallback((id: string) => noteDragIds(state, id), [state]);
  const clear = useCallback(() => setState(EMPTY_NOTE_SELECTION), []);

  return useMemo(
    () => ({ selectedIds: state.ids, count: state.ids.size, onRowClick, dragIds, clear }),
    [state.ids, onRowClick, dragIds, clear],
  );
}
