import { useEffect, useRef } from "preact/hooks";
import type { NoteMeta } from "../lib/mistlib";

interface Options {
  activeId: string;
  notes: NoteMeta[];
  selectNote: (id: string) => void | Promise<void>;
}

// Rewrites only the `note` query param, leaving everything else (e.g.
// collab's `?room=`) untouched.
export function withNoteParam(id: string | null): string {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("note", id);
  else url.searchParams.delete("note");
  return url.toString();
}

// Reflects the active note in the URL as `?note=<id>` and supports
// deep-linking: opening a URL with `?note=<id>` opens that note on load, and
// browser back/forward navigates between previously visited notes.
//
// A brand-new, not-yet-saved note has no durable id worth linking to, so the
// `note` param is omitted until autosave persists it.
export function useNoteUrlSync({ activeId, notes, selectNote }: Options) {
  const didInitialLoad = useRef(false);
  const prevActiveId = useRef(activeId);
  // Set right before a transition that shouldn't create a new history entry
  // (initial deep link, popstate-driven switch) so the next URL-sync effect
  // uses replaceState instead of pushState.
  const suppressPush = useRef(false);

  // Initial load: honor ?note=<id> if it names a note that still exists;
  // otherwise scrub the stale param instead of leaving a dead link in the bar.
  // Exception: a `?room=` alongside an unrecognized `?note=` is an invite
  // link for a note we don't have yet — app.tsx's own mount effect reads
  // `note` to create/join that note before joining the room, so stripping it
  // here first (this effect commits first, both being mount effects on the
  // same component) would silently drop the note id and leave the joiner
  // only in the room with no note ever created.
  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("note");
    const hasRoom = !!params.get("room");
    const matched = !!(requested && notes.some((n) => n.id === requested));
    console.debug("[collab] useNoteUrlSync: initial load", { requested, matched, hasRoom });
    if (requested && matched) {
      suppressPush.current = true;
      selectNote(requested);
    } else if (requested && !hasRoom) {
      console.debug("[collab] useNoteUrlSync: stripping unrecognized ?note= param", { requested });
      window.history.replaceState(window.history.state, "", withNoteParam(null));
    } else if (requested) {
      console.debug("[collab] useNoteUrlSync: preserving ?note= param because ?room= is present", {
        requested,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Keep the URL's `note` param in sync with the active note. A change of
  // note gets its own history entry (pushState) unless it was triggered by
  // popstate or the initial deep link, in which case replaceState avoids
  // duplicating an entry that already exists.
  useEffect(() => {
    if (!didInitialLoad.current) return;
    const persisted = notes.some((n) => n.id === activeId);
    const nextUrl = withNoteParam(persisted ? activeId : null);
    const idChanged = prevActiveId.current !== activeId;
    if (idChanged && !suppressPush.current) {
      window.history.pushState({ noteId: activeId }, "", nextUrl);
    } else {
      window.history.replaceState({ noteId: activeId }, "", nextUrl);
    }
    prevActiveId.current = activeId;
    suppressPush.current = false;
  }, [activeId, notes]);

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as { noteId?: string } | null;
      const id = state?.noteId ?? new URLSearchParams(window.location.search).get("note");
      if (!id || id === activeId || !notes.some((n) => n.id === id)) return;
      suppressPush.current = true;
      selectNote(id);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, notes]);
}
