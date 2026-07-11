import { useEffect, useMemo, useState } from "preact/hooks";
import { useT } from "../hooks/useAppSettings";
import { useAiTaskQueue } from "../hooks/useAiTaskQueue";
import { enqueueAiTask, cancelAiTask, dismissAiTask, type AiTask } from "../lib/aiTaskQueue";
import { Icon } from "./Icon";
import { splitBlocks } from "../lib/blocks";
import { findDuplicateSentences } from "../lib/duplicateDetection";
import {
  buildReviewPrompt,
  parseReviewResponse,
  getRubricById,
  RUBRICS,
  DEFAULT_RUBRIC_ID,
  type RubricResult,
} from "../lib/reviewRubric";
import { formatMistaiError, MESSAGES_EN, MESSAGES_JA } from "@tik-choco/mistai";
import type { UseLlmNetResult } from "../hooks/useLlmNet";
import type { TranslationKey } from "../lib/i18n";

// Persists the last-chosen rubric across sessions, same "tc-note:" prefix
// convention as appSettings.ts / llmSettings.ts.
const RUBRIC_STORAGE_KEY = "tc-note:review-rubric";

// Maps a rubric criterion id to its display-label translation key. Kept here
// (not in reviewRubric.ts) so the pure rubric lib stays decoupled from i18n.
// Criteria with the same meaning across rubrics (clarity, structure, ...)
// intentionally share one label key.
const CRITERION_LABEL_KEYS: Record<string, TranslationKey> = {
  technicalContent: "reviewPanel.criterion.technicalContent",
  originality: "reviewPanel.criterion.originality",
  clarity: "reviewPanel.criterion.clarity",
  significance: "reviewPanel.criterion.significance",
  presentationStyle: "reviewPanel.criterion.presentationStyle",
  hookEngagement: "reviewPanel.criterion.hookEngagement",
  structure: "reviewPanel.criterion.structure",
  accuracySupport: "reviewPanel.criterion.accuracySupport",
  style: "reviewPanel.criterion.style",
  accuracy: "reviewPanel.criterion.accuracy",
  completeness: "reviewPanel.criterion.completeness",
  examples: "reviewPanel.criterion.examples",
  coherence: "reviewPanel.criterion.coherence",
  tone: "reviewPanel.criterion.tone",
  polish: "reviewPanel.criterion.polish",
};

const RUBRIC_LABEL_KEYS: Record<string, TranslationKey> = {
  research: "reviewPanel.rubric.research",
  article: "reviewPanel.rubric.article",
  docs: "reviewPanel.rubric.docs",
  general: "reviewPanel.rubric.general",
};

// The shape stored as an AiTask's `result` for a "review" task — the raw LLM
// reply plus which rubric it was scored against (parsing needs the rubric's
// criteria list, and the rubric the user has selected may have changed while
// the task was running).
interface ReviewTaskResult {
  raw: string;
  rubricId: string;
}

type ParsedOutcome = { ok: true; value: RubricResult } | { ok: false; raw: string };

const PENDING_STATUSES = new Set(["queued", "running", "cancelling"]);

function loadStoredRubricId(): string {
  try {
    const raw = localStorage.getItem(RUBRIC_STORAGE_KEY);
    return raw && RUBRICS.some((r) => r.id === raw) ? raw : DEFAULT_RUBRIC_ID;
  } catch {
    // localStorage unavailable (private mode etc.) — just use the default.
    return DEFAULT_RUBRIC_ID;
  }
}

function scoreTier(score: number): "low" | "mid" | "high" {
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

// A side panel that runs "Review" mode: a free, local duplicate-sentence
// scan (shown immediately) plus an on-demand LLM judge that scores the note
// against a user-chosen rubric (research paper, article, docs, or general
// writing). Mirrors LlmChatPanel's structure (transport-blocked/hint
// handling, header layout).
//
// The LLM judge call runs through the background AI task queue
// (../lib/aiTaskQueue.ts) rather than as a promise owned by this component:
// closing the panel (or navigating away) no longer drops an in-flight
// review — it keeps running, and its retained result is picked back up the
// next time this panel mounts for the same note.
export function ReviewPanel(props: {
  net: UseLlmNetResult;
  noteTitle: string;
  noteText: string;
  language: string;
  onClose: () => void;
  /** Identifies which note this panel's review task belongs to, so the queue
   * can track/dedupe/retain per-note and reviews for different notes don't
   * collide. Falls back to a fixed key when the caller hasn't wired a real
   * note id through yet. */
  noteId?: string;
}) {
  const { net, noteTitle, noteText, language, onClose, noteId } = props;
  const t = useT();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;
  const noteKey = noteId ?? "current-note";

  const [rubricId, setRubricId] = useState<string>(() => loadStoredRubricId());
  const rubric = useMemo(() => getRubricById(rubricId), [rubricId]);

  const allTasks = useAiTaskQueue();
  // At most one task should ever match (dedupeKey scopes review tasks to one
  // per noteKey), but pick the most recently created one defensively.
  const task = useMemo<AiTask<ReviewTaskResult> | undefined>(() => {
    const matches = allTasks.filter((task) => task.kind === "review" && task.noteId === noteKey);
    return matches[matches.length - 1] as AiTask<ReviewTaskResult> | undefined;
  }, [allTasks, noteKey]);

  const pending = task ? PENDING_STATUSES.has(task.status) : false;
  const queued = task?.status === "queued";
  const streamedChars = task?.progress.chars ?? 0;

  const parsed = useMemo<ParsedOutcome | null>(() => {
    if (!task || task.status !== "complete" || !task.result) return null;
    try {
      return { ok: true, value: parseReviewResponse(task.result.raw, getRubricById(task.result.rubricId)) };
    } catch {
      return { ok: false, raw: task.result.raw };
    }
  }, [task]);

  // Holds the last successfully parsed scorecard so it can keep showing
  // (dimmed) while a re-run is pending, or stay visible if a re-run later
  // fails — the retained task itself gets replaced/removed on every new
  // enqueue, so this is tracked independently in local state.
  const [lastResult, setLastResult] = useState<RubricResult | null>(null);

  useEffect(() => {
    if (parsed?.ok) setLastResult(parsed.value);
  }, [parsed]);

  // A different note's (or no) review shouldn't keep showing this note's
  // previous scorecard as a "stale" fallback.
  useEffect(() => {
    setLastResult(null);
  }, [noteKey]);

  const displayResult = parsed?.ok ? parsed.value : lastResult;
  const isStale = pending && displayResult != null;

  const errorMessage =
    task?.status === "failed" ? task.error : parsed && !parsed.ok ? t("reviewPanel.parseError") : null;
  const rawResponse = parsed && !parsed.ok ? parsed.raw : null;

  // Free/local, no button needed — recomputed whenever the note text changes.
  const duplicateMatches = useMemo(() => findDuplicateSentences(splitBlocks(noteText)), [noteText]);
  // A handful of matches are shown expanded by default; a longer list starts
  // collapsed so the panel doesn't open dominated by the free check.
  const duplicatesDefaultOpen = duplicateMatches.length > 0 && duplicateMatches.length <= 3;

  // Same transport-blocked/hint pattern as LlmChatPanel.
  const transportBlocked =
    (net.connection === "network" && !net.networkAvailable) || (net.connection === "api" && !net.apiReady);

  const hint =
    net.connection === "network" && !net.networkAvailable
      ? t("reviewPanel.hint.needRoom")
      : net.connection === "network" && net.providerCount === 0
        ? t("reviewPanel.hint.searchingProvider")
        : net.connection === "api" && !net.apiReady
          ? t("reviewPanel.hint.needProvider")
          : null;

  function handleRubricChange(id: string) {
    setRubricId(id);
    try {
      localStorage.setItem(RUBRIC_STORAGE_KEY, id);
    } catch {
      // localStorage unavailable — the choice just won't persist.
    }
    // A previous result's criteria belong to the old rubric; drop it rather
    // than showing scores under the wrong labels. The select is disabled
    // while pending, so `task` here is always a terminal (or absent) task.
    if (task) dismissAiTask(task.id);
    setLastResult(null);
  }

  function handleRunReview() {
    if (pending || transportBlocked) return;
    // Captures net.send, the prompt inputs, and mistaiMessages at enqueue
    // time, so the review runs to completion independent of this panel's
    // lifecycle (closing/reopening the panel just re-observes the same task
    // via the noteId + dedupeKey below).
    enqueueAiTask<ReviewTaskResult>({
      kind: "review",
      title: noteTitle.trim() || t("reviewPanel.title"),
      noteId: noteKey,
      dedupeKey: `review:${noteKey}`,
      retain: true,
      run: async ({ signal, setProgress }) => {
        try {
          const raw = await net.send(
            buildReviewPrompt({ rubric, title: noteTitle, content: noteText, language }),
            (_delta, full) => setProgress({ chars: full.length }),
            signal,
          );
          return { raw, rubricId: rubric.id };
        } catch (err) {
          // Rethrow with the user-facing message so task.error is
          // display-ready. A plain Error (not a formatted AbortError) is
          // fine here — the queue itself detects cancellation via the abort
          // signal before this even reaches the .catch that would set
          // `error`, so cancellation is never mis-shown as a failure.
          throw new Error(formatMistaiError(err, mistaiMessages, err instanceof Error ? err.message : String(err)));
        }
      },
    });
  }

  function handleCancelReview() {
    if (task) cancelAiTask(task.id);
  }

  return (
    <aside class="review-panel" role="complementary" aria-label={t("reviewPanel.title")}>
      <div class="review-panel-header">
        <span class="review-panel-title">{t("reviewPanel.title")}</span>
        <button
          type="button"
          class="icon-btn"
          onClick={onClose}
          aria-label={t("reviewPanel.close")}
          title={t("reviewPanel.close")}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div class="review-panel-body">
        <section class="review-section">
          <div class="review-section-header">
            <h3 class="review-section-title">{t("reviewPanel.consistency.title")}</h3>
          </div>
          {duplicateMatches.length === 0 ? (
            <p class="review-consistency-empty">{t("reviewPanel.consistency.empty")}</p>
          ) : (
            <details class="review-duplicates" open={duplicatesDefaultOpen}>
              <summary class="review-duplicates-summary">
                <span>{t("reviewPanel.consistency.toggle")}</span>
                <span class="review-count-badge">{duplicateMatches.length}</span>
              </summary>
              <ul class="review-duplicate-list">
                {duplicateMatches.map((m, i) => (
                  <li key={i} class="review-duplicate-item">
                    <div class="review-duplicate-pair-label">
                      {t("reviewPanel.consistency.pairLabel", { a: m.a.blockIndex + 1, b: m.b.blockIndex + 1 })}
                    </div>
                    <p class="review-duplicate-sentence">{m.a.sentence}</p>
                    <p class="review-duplicate-sentence">{m.b.sentence}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section class="review-section">
          <div class="review-section-header">
            <h3 class="review-section-title">{t("reviewPanel.judge.title")}</h3>
            <select
              class="review-rubric-select"
              value={rubricId}
              disabled={pending}
              aria-label={t("reviewPanel.rubric.label")}
              title={t("reviewPanel.rubric.label")}
              onChange={(e) => handleRubricChange((e.target as HTMLSelectElement).value)}
            >
              {RUBRICS.map((r) => (
                <option key={r.id} value={r.id}>
                  {t(RUBRIC_LABEL_KEYS[r.id])}
                </option>
              ))}
            </select>
          </div>

          <div class="review-run-row">
            <button
              type="button"
              class="review-run-btn"
              onClick={handleRunReview}
              disabled={pending || transportBlocked}
            >
              {pending ? t("reviewPanel.running") : displayResult ? t("reviewPanel.rerunButton") : t("reviewPanel.runButton")}
            </button>
            {pending && (
              <span class="review-generating" role="status" aria-live="polite">
                <span class="review-generating-label">
                  {queued ? t("reviewPanel.queue.queued") : t("reviewPanel.generating")}
                </span>
                {!queued && (
                  <span class="review-generating-dots" aria-hidden="true">
                    <span class="review-generating-dot" />
                    <span class="review-generating-dot" />
                    <span class="review-generating-dot" />
                  </span>
                )}
                {streamedChars > 0 && (
                  <span class="review-generating-count">
                    {t("reviewPanel.streamedChars", { count: streamedChars })}
                  </span>
                )}
                <button
                  type="button"
                  class="review-cancel-btn"
                  onClick={handleCancelReview}
                  disabled={task?.status === "cancelling"}
                  aria-label={t("reviewPanel.queue.cancel")}
                  title={t("reviewPanel.queue.cancel")}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            )}
          </div>

          {hint && <div class="review-hint">{hint}</div>}

          {errorMessage && (
            <div class="review-error">
              <p>{errorMessage}</p>
              {rawResponse && (
                <details class="review-raw-details">
                  <summary>{t("reviewPanel.rawResponse")}</summary>
                  <pre>{rawResponse}</pre>
                </details>
              )}
            </div>
          )}

          {displayResult && (
            <div class={`review-scorecard ${isStale ? "review-scorecard--stale" : ""}`}>
              <div class={`review-overall review-overall--${scoreTier(displayResult.overallScore)}`}>
                <span class="review-overall-label">{t("reviewPanel.overallScore")}</span>
                <span class="review-overall-value">
                  {displayResult.overallScore.toFixed(1)}
                  <span class="review-overall-max">/10</span>
                </span>
              </div>
              <div class="review-summary">
                <span class="review-summary-label">{t("reviewPanel.summary")}</span>
                <p>{displayResult.summary}</p>
              </div>

              {rubric.criteria.map((def) => {
                const criterion = displayResult.criteria.find((c) => c.id === def.id);
                if (!criterion) return null;
                const tier = scoreTier(criterion.score);
                return (
                  <div key={def.id} class="review-criterion">
                    <div class="review-criterion-header">
                      <span class="review-criterion-label">{t(CRITERION_LABEL_KEYS[def.id])}</span>
                      <span class={`review-criterion-score review-criterion-score--${tier}`}>
                        {criterion.score.toFixed(1)}
                      </span>
                    </div>
                    <div class="review-bar-track">
                      <div
                        class={`review-bar-fill review-bar-fill--${tier}`}
                        style={{ width: `${(criterion.score / 10) * 100}%` }}
                      />
                    </div>
                    <p class="review-criterion-comment">{criterion.comment}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
