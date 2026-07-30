import { useEffect, useState } from "preact/hooks";
import { listVersions, loadVersion, type HistoryEntry } from "../lib/noteHistory";
import { useT } from "../hooks/useAppSettings";
import { Icon } from "./Icon";

// First ~400 chars of a version's content, shown read-only before restoring
// it — enough to recognize "yes, this is the version I want" without pulling
// in a full Markdown renderer for what's a disposable preview.
const PREVIEW_CHARS = 400;

// Docks in the same right-edge slot as the chat/review panels (see app.tsx),
// listing the active note's recorded versions newest first — see
// lib/noteHistory.ts for why this list already exists cheaply: mistlib is
// content-addressed, so every past save is already durably stored, this is
// just the pointer list back to them.
export function HistoryPanel(props: {
  noteId: string;
  /** The active note session's save-status tag (see useNoteSession) — used
   * only as a signal to re-read the version list after a fresh autosave
   * lands, not displayed. */
  status: string;
  onClose: () => void;
  /** Called with the restored Markdown once it's been fetched — the caller
   * is responsible for actually applying it (through the normal edit path,
   * so autosave/collab pick it up) and showing the restored/failed toast. */
  onRestore: (markdown: string) => void;
  onRestoreFailed: () => void;
}) {
  const { noteId, status, onClose, onRestore, onRestoreFailed } = props;
  const t = useT();

  const [versions, setVersions] = useState<HistoryEntry[]>(() => listVersions(noteId));
  const [selectedCid, setSelectedCid] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Re-read the list whenever the active note changes, or whenever this
  // note's save status settles (a fresh autosave just recorded a new
  // version — see mistlib.ts's saveNote/recordVersion).
  useEffect(() => {
    setVersions(listVersions(noteId));
  }, [noteId, status]);

  // Switching notes (or the list changing under the current selection)
  // drops any open preview rather than showing stale content next to the
  // wrong note's list.
  useEffect(() => {
    setSelectedCid(null);
    setPreviewText(null);
    setPreviewFailed(false);
  }, [noteId]);

  async function handleSelect(entry: HistoryEntry) {
    if (selectedCid === entry.cid) {
      setSelectedCid(null);
      return;
    }
    setSelectedCid(entry.cid);
    setPreviewText(null);
    setPreviewFailed(false);
    setPreviewLoading(true);
    try {
      const markdown = await loadVersion(entry.cid);
      setPreviewText(markdown.slice(0, PREVIEW_CHARS));
    } catch (err) {
      console.warn("history: failed to load version preview", err);
      setPreviewFailed(true);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestore(entry: HistoryEntry) {
    if (restoring) return;
    setRestoring(true);
    try {
      const markdown = await loadVersion(entry.cid);
      onRestore(markdown);
    } catch (err) {
      console.warn("history: failed to load version for restore", err);
      onRestoreFailed();
    } finally {
      setRestoring(false);
    }
  }

  const now = Date.now();

  function relativeTime(at: number): string {
    const diffMs = Math.max(0, now - at);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t("history.justNow");
    if (minutes < 60) return t("history.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("history.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("history.daysAgo", { count: days });
  }

  return (
    <aside class="history-panel" role="complementary" aria-label={t("history.title")}>
      <div class="history-panel-header">
        <span class="history-panel-title">{t("history.title")}</span>
        {versions.length > 0 && (
          <span class="history-panel-count">{t("history.versionCount", { count: versions.length })}</span>
        )}
        <button
          type="button"
          class="icon-btn"
          onClick={onClose}
          aria-label={t("history.close")}
          title={t("history.close")}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div class="history-panel-body">
        {versions.length === 0 ? (
          <p class="history-empty">{t("history.empty")}</p>
        ) : (
          <ul class="history-list">
            {versions.map((entry, i) => {
              const selected = selectedCid === entry.cid;
              return (
                <li key={entry.cid} class="history-item">
                  <button
                    type="button"
                    class={`history-item-row ${selected ? "history-item-row--selected" : ""}`}
                    onClick={() => handleSelect(entry)}
                    aria-expanded={selected}
                  >
                    <Icon name="history" size={16} class="history-item-icon" />
                    <span class="history-item-time">{relativeTime(entry.at)}</span>
                    {i === 0 && <span class="history-item-current">{t("history.current")}</span>}
                    <span class="history-item-chars">{entry.chars}</span>
                  </button>

                  {selected && (
                    <div class="history-preview">
                      {previewLoading && <p class="history-preview-status">{t("history.previewLabel")}...</p>}
                      {previewFailed && <p class="history-preview-error">{t("history.restoreFailed")}</p>}
                      {previewText !== null && !previewLoading && !previewFailed && (
                        <>
                          <div class="history-preview-label">{t("history.previewLabel")}</div>
                          <pre class="history-preview-text">{previewText}</pre>
                        </>
                      )}
                      <button
                        type="button"
                        class="history-restore-btn"
                        disabled={previewLoading || previewFailed || restoring}
                        onClick={() => handleRestore(entry)}
                      >
                        {t("history.restore")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
