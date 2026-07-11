// Module-level singleton background task queue for long-running AI work
// (note review, chat completions, ...). tc-note used to run these as bare
// promises inside panel components — closing the panel unmounted it and
// silently dropped the in-flight result. This queue lives outside any
// component's lifecycle, so a task keeps running (and its result keeps
// waiting to be seen) across navigation, panel close/reopen, etc. Modeled on
// the sibling app tc-pdf-viewer's serial AI queue.
//
// Framework-agnostic on purpose: this module has no Preact imports. See
// ../hooks/useAiTaskQueue.ts for the subscribe-to-snapshot hook that panels
// bind against.
//
// Concurrency is deliberately 1 (serial drain): only one task runs at a
// time, FIFO. This mirrors how a single shared LLM connection/provider slot
// works elsewhere in the app (see llmNet.ts) — running two AI calls at once
// wouldn't make either faster, it'd just contend for the same upstream.
//
// State (the task list, the running AbortControllers, and pending retention
// timers) is plain module-level state, not wrapped in a class — there is
// exactly one queue for the whole app, so a singleton is simpler than an
// instance callers would have to thread through.

export type AiTaskStatus = "queued" | "running" | "cancelling" | "complete" | "failed" | "cancelled";

export interface AiTaskProgress {
  /** Free-form progress note (e.g. "Streaming...") */
  text?: string;
  /** Streamed character count, for "1,234 chars" style display */
  chars?: number;
  done?: number;
  total?: number;
}

export interface AiTaskRunContext {
  signal: AbortSignal;
  setProgress: (progress: AiTaskProgress) => void;
}

export interface AiTask<R = unknown> {
  id: number;
  kind: string; // e.g. "review" | "chat"
  title: string; // human-readable label for queue UI
  noteId?: string;
  dedupeKey?: string;
  retain: boolean;
  status: AiTaskStatus;
  progress: AiTaskProgress;
  error: string; // message when status === "failed"
  result?: R; // set when status === "complete"
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface EnqueueAiTaskInput<R> {
  kind: string;
  title: string;
  noteId?: string;
  dedupeKey?: string;
  /** Keep the terminal task (with result) in the list until dismissed or replaced. Default false. */
  retain?: boolean;
  run: (ctx: AiTaskRunContext) => Promise<R>;
}

/** How long a non-retained terminal task lingers in the list before being auto-removed. */
export const AI_TASK_RETENTION_MS = 8000;

const PENDING_STATUSES: readonly AiTaskStatus[] = ["queued", "running", "cancelling"];

// The run function isn't part of the public AiTask shape (it's not
// serializable/displayable state), so it's tracked in a side table keyed by
// task id instead of being carried on the task object.
const runners = new Map<number, (ctx: AiTaskRunContext) => Promise<unknown>>();
// AbortControllers are likewise not on the task object (per the spec) — kept
// here so cancelAiTask can reach the controller for a running task by id.
const controllers = new Map<number, AbortController>();
const retentionTimers = new Map<number, ReturnType<typeof setTimeout>>();

let tasks: readonly AiTask[] = [];
let nextId = 1;
let draining = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[aiTaskQueue] listener failed", err);
    }
  }
}

/** Replaces the snapshot array (immutably) and notifies subscribers. */
function setTasks(next: readonly AiTask[]): void {
  tasks = next;
  notify();
}

function replaceTask(id: number, patch: Partial<AiTask>): void {
  setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch, progress: { ...t.progress, ...patch.progress } } : t)));
}

function findTask(id: number): AiTask | undefined {
  return tasks.find((t) => t.id === id);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function scheduleRemoval(id: number): void {
  clearTimeout(retentionTimers.get(id));
  const timer = setTimeout(() => {
    retentionTimers.delete(id);
    const task = findTask(id);
    // Guard: never remove a task that's since become pending again (e.g. a
    // dedupe re-run reused this id — it never does today, but this keeps the
    // guard meaningful if that ever changes) or that's already gone.
    if (!task || PENDING_STATUSES.includes(task.status)) return;
    setTasks(tasks.filter((t) => t.id !== id));
  }, AI_TASK_RETENTION_MS);
  retentionTimers.set(id, timer);
}

function settleTask(id: number, patch: Partial<AiTask>): void {
  controllers.delete(id);
  runners.delete(id);
  replaceTask(id, { ...patch, finishedAt: Date.now() });
  const task = findTask(id);
  if (task && !task.retain) {
    scheduleRemoval(id);
  }
}

/** Kicks off the drain loop if it isn't already running. Scheduled via setTimeout(0) to avoid re-entrancy with the caller that just mutated `tasks`. */
function scheduleDrain(): void {
  if (draining) return;
  draining = true;
  setTimeout(drain, 0);
}

function drain(): void {
  draining = false;
  if (tasks.some((t) => t.status === "running" || t.status === "cancelling")) return;
  const next = tasks.find((t) => t.status === "queued");
  if (!next) return;
  runTask(next.id);
}

function runTask(id: number): void {
  const runner = runners.get(id);
  const task = findTask(id);
  if (!runner || !task) return;

  const controller = new AbortController();
  controllers.set(id, controller);
  replaceTask(id, { status: "running", startedAt: Date.now() });

  const setProgress = (progress: AiTaskProgress) => {
    const current = findTask(id);
    if (!current || current.status === "complete" || current.status === "failed" || current.status === "cancelled") return;
    replaceTask(id, { progress });
  };

  runner({ signal: controller.signal, setProgress })
    .then((result) => {
      settleTask(id, { status: "complete", result });
    })
    .catch((err) => {
      if (controller.signal.aborted || isAbortError(err)) {
        settleTask(id, { status: "cancelled" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        settleTask(id, { status: "failed", error: message });
      }
    })
    .finally(() => {
      scheduleDrain();
    });
}

export function enqueueAiTask<R>(input: EnqueueAiTaskInput<R>): AiTask<R> {
  if (input.dedupeKey) {
    const existingPending = tasks.find((t) => t.dedupeKey === input.dedupeKey && PENDING_STATUSES.includes(t.status));
    if (existingPending) return existingPending as AiTask<R>;

    const existingTerminal = tasks.find((t) => t.dedupeKey === input.dedupeKey && t.retain);
    if (existingTerminal) {
      clearTimeout(retentionTimers.get(existingTerminal.id));
      retentionTimers.delete(existingTerminal.id);
      setTasks(tasks.filter((t) => t.id !== existingTerminal.id));
    }
  }

  const task: AiTask<R> = {
    id: nextId++,
    kind: input.kind,
    title: input.title,
    noteId: input.noteId,
    dedupeKey: input.dedupeKey,
    retain: input.retain ?? false,
    status: "queued",
    progress: {},
    error: "",
    createdAt: Date.now(),
  };

  runners.set(task.id, input.run as (ctx: AiTaskRunContext) => Promise<unknown>);
  setTasks([...tasks, task]);
  scheduleDrain();

  return task;
}

export function cancelAiTask(id: number): void {
  const task = findTask(id);
  if (!task) return;

  if (task.status === "queued") {
    settleTask(id, { status: "cancelled" });
    return;
  }

  if (task.status === "running") {
    replaceTask(id, { status: "cancelling" });
    controllers.get(id)?.abort();
    return;
  }

  // "cancelling" / terminal: no-op.
}

export function dismissAiTask(id: number): void {
  clearTimeout(retentionTimers.get(id));
  retentionTimers.delete(id);
  setTasks(tasks.filter((t) => t.id !== id));
}

export function getAiTasks(): readonly AiTask[] {
  return tasks;
}

export function subscribeAiTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: clear all state. */
export function __resetAiTaskQueueForTests(): void {
  for (const timer of retentionTimers.values()) clearTimeout(timer);
  retentionTimers.clear();
  controllers.clear();
  runners.clear();
  tasks = [];
  nextId = 1;
  draining = false;
  listeners.clear();
}
