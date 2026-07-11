import type { JSX } from "preact";
import { useAiTaskQueue } from "../hooks/useAiTaskQueue";
import { useT } from "../hooks/useAppSettings";
import { cancelAiTask, dismissAiTask, type AiTask, type AiTaskStatus } from "../lib/aiTaskQueue";
import type { TranslationKey } from "../lib/i18n";
import { Icon } from "./Icon";

// Only the most recent handful of tasks are shown — this is a glance-and-go
// affordance, not a full task manager. Older tasks are still tracked by the
// queue and reachable once they scroll into the visible window.
const MAX_VISIBLE_TASKS = 4;

const PENDING_STATUSES: readonly AiTaskStatus[] = ["queued", "running", "cancelling"];

// task.kind is a free-form string (see aiTaskQueue.ts); only the two kinds
// tc-note currently enqueues get a translated label, everything else falls
// back to the raw kind so a future kind doesn't render blank.
const KIND_LABEL_KEY: Record<string, TranslationKey | undefined> = {
  review: "aiQueue.kind.review",
  chat: "aiQueue.kind.chat",
};

const STATUS_LABEL_KEY: Record<AiTaskStatus, TranslationKey> = {
  queued: "aiQueue.status.queued",
  running: "aiQueue.status.running",
  cancelling: "aiQueue.status.cancelling",
  complete: "aiQueue.status.complete",
  failed: "aiQueue.status.failed",
  cancelled: "aiQueue.status.cancelled",
};

/** Global floating "background AI work" indicator (bottom-right). Renders
 * nothing when the queue is empty — tasks that finish and aren't retained
 * disappear from the queue on their own (see AI_TASK_RETENTION_MS), so this
 * naturally fades away rather than needing its own dismiss-all control. */
export function AiQueueIndicator(props: { onOpenTask?: (task: AiTask) => void }) {
  const { onOpenTask } = props;
  const t = useT();
  const tasks = useAiTaskQueue();

  if (tasks.length === 0) return null;

  const pendingCount = tasks.filter((task) => PENDING_STATUSES.includes(task.status)).length;
  const isActive = tasks.some((task) => task.status === "running" || task.status === "cancelling");
  // Newest first, capped — tasks are appended to the queue in creation order.
  const visible = tasks.slice(-MAX_VISIBLE_TASKS).reverse();

  function handleRowKeyDown(e: JSX.TargetedKeyboardEvent<HTMLLIElement>, task: AiTask) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpenTask?.(task);
  }

  function handleActionClick(e: JSX.TargetedMouseEvent<HTMLButtonElement>, task: AiTask, isPending: boolean) {
    e.stopPropagation();
    if (isPending) cancelAiTask(task.id);
    else dismissAiTask(task.id);
  }

  return (
    <div class="ai-queue-indicator" role="status" aria-live="polite">
      <div class="ai-queue-header">
        {isActive && <span class="ai-queue-spinner" aria-hidden="true" />}
        <span class="ai-queue-title">{t("aiQueue.title")}</span>
        {pendingCount > 1 && (
          <span class="ai-queue-count" aria-label={t("aiQueue.pendingCount", { count: pendingCount })}>
            {pendingCount}
          </span>
        )}
      </div>
      <ul class="ai-queue-list">
        {visible.map((task) => {
          const kindKey = KIND_LABEL_KEY[task.kind];
          const kindLabel = kindKey ? t(kindKey) : task.kind;
          const isPending = PENDING_STATUSES.includes(task.status);
          const chars = task.status === "running" ? task.progress.chars : undefined;
          return (
            <li
              key={task.id}
              class="ai-queue-row"
              role="button"
              tabIndex={0}
              onClick={() => onOpenTask?.(task)}
              onKeyDown={(e) => handleRowKeyDown(e, task)}
            >
              <div class="ai-queue-row-main">
                <span class="ai-queue-kind">{kindLabel}</span>
                <span class="ai-queue-row-title" title={task.title}>
                  {task.title}
                </span>
                <button
                  type="button"
                  class="ai-queue-row-close"
                  aria-label={isPending ? t("aiQueue.cancel") : t("aiQueue.dismiss")}
                  onClick={(e) => handleActionClick(e, task, isPending)}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
              <div class="ai-queue-row-status">
                {t(STATUS_LABEL_KEY[task.status])}
                {typeof chars === "number" && chars > 0 && (
                  <span class="ai-queue-row-chars"> · {t("aiQueue.streamedChars", { count: chars })}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
