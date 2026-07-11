import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { loadNote, type Folder, type NoteMeta } from "../lib/mistlib";
import { searchNotes, type HighlightSegment } from "../lib/globalSearch";
import { isImeComposing } from "../lib/util";
import { useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { Icon } from "./Icon";

const DEBOUNCE_MS = 120;
const RESULT_LIMIT = 50;

// A command-palette-style modal (Ctrl+Shift+F) that searches note titles AND
// full bodies. Bodies live behind async wasm storage, so we load them all once
// on open into a local cache and run the pure `searchNotes` ranking over it.
export function GlobalSearchModal(props: {
  notes: NoteMeta[];
  folders: Folder[];
  onOpenNote: (id: string) => void;
  onClose: () => void;
}) {
  const { notes, folders, onOpenNote, onClose } = props;
  const t = useT();
  const modalRef = useModalA11y(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const listRef = useRef<HTMLUListElement | null>(null);

  // null while the one-time body load is in flight; a full id -> body map once
  // ready (per-note failures resolve to "").
  const [bodies, setBodies] = useState<Record<string, string> | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Load every note body once, tolerating per-note failures.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      notes.map((n) =>
        loadNote(n.id)
          .then((body) => [n.id, body] as const)
          .catch(() => [n.id, ""] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setBodies(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [notes]);

  // Debounce typing so ranking doesn't run on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const results = useMemo(
    () => searchNotes(notes, bodies ?? {}, debouncedQuery, RESULT_LIMIT),
    [notes, bodies, debouncedQuery],
  );

  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const loading = bodies === null;
  const hasQuery = debouncedQuery.trim().length > 0;

  function handleInputKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
    // Never navigate/commit mid-IME-composition — that's the user picking a
    // conversion candidate, not choosing a result.
    if (isImeComposing(e)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[selectedIndex];
      if (result) onOpenNote(result.note.id);
    }
  }

  function renderSegments(segments: HighlightSegment[]) {
    return segments.map((seg, i) =>
      seg.match ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
    );
  }

  const activeOptionId =
    results.length > 0 ? `global-search-option-${selectedIndex}` : undefined;

  return (
    <div class="global-search-overlay" {...overlayDismiss}>
      <div
        class="global-search"
        role="dialog"
        aria-modal="true"
        aria-label={t("globalSearch.title")}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="global-search-input-row">
          <Icon name="search" class="global-search-input-icon" />
          <input
            type="text"
            class="global-search-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-listbox"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label={t("globalSearch.ariaLabel")}
            aria-describedby="global-search-hint"
            placeholder={t("globalSearch.placeholder")}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={handleInputKeyDown}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        <span id="global-search-hint" class="global-search-sr-only">
          {t("globalSearch.hint")}
        </span>

        <div class="global-search-body">
          {loading ? (
            <div class="global-search-status">
              <span class="spinner" aria-hidden="true" /> {t("globalSearch.loading")}
            </div>
          ) : (
            <>
              <div class="global-search-meta" aria-live="polite">
                {hasQuery ? t("globalSearch.resultCount", { count: results.length }) : t("globalSearch.recent")}
              </div>
              {results.length === 0 ? (
                hasQuery && <div class="global-search-empty">{t("globalSearch.empty")}</div>
              ) : (
                <ul
                  class="global-search-results"
                  id="global-search-listbox"
                  role="listbox"
                  aria-label={t("globalSearch.title")}
                  ref={listRef}
                >
                  {results.map((result, i) => {
                    const folder = result.note.folderId
                      ? folders.find((f) => f.id === result.note.folderId)
                      : undefined;
                    const hasSnippet = result.snippetSegments.length > 0;
                    return (
                      <li
                        key={result.note.id}
                        id={`global-search-option-${i}`}
                        class={`global-search-result${i === selectedIndex ? " is-selected" : ""}`}
                        role="option"
                        aria-selected={i === selectedIndex}
                        aria-label={`${t("globalSearch.openAriaLabel")}: ${result.note.title || t("pageTitle.placeholder")}`}
                        data-index={i}
                        onMouseMove={() => setSelectedIndex(i)}
                        onClick={() => onOpenNote(result.note.id)}
                      >
                        <div class="global-search-result-head">
                          <span class="global-search-result-title">
                            {result.note.title
                              ? renderSegments(result.titleSegments)
                              : t("pageTitle.placeholder")}
                          </span>
                          {folder && (
                            <span class="global-search-result-folder">
                              <Icon name="folder" size={13} />
                              {folder.name}
                            </span>
                          )}
                        </div>
                        {hasSnippet && (
                          <div class="global-search-result-snippet">
                            {renderSegments(result.snippetSegments)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <div class="global-search-footer">
          <span class="global-search-footer-hint">
            <kbd class="global-search-kbd">↑</kbd>
            <kbd class="global-search-kbd">↓</kbd>
            {t("globalSearch.footerNavigate")}
          </span>
          <span class="global-search-footer-hint">
            <kbd class="global-search-kbd">↵</kbd>
            {t("globalSearch.footerOpen")}
          </span>
          <span class="global-search-footer-hint">
            <kbd class="global-search-kbd">Esc</kbd>
            {t("globalSearch.footerClose")}
          </span>
        </div>
      </div>
    </div>
  );
}
