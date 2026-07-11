// Exercises the module-level singleton task queue (lib/aiTaskQueue.ts):
// serial FIFO draining, success/failure/cancel outcomes, dedupe, retention,
// and subscriber notification. Fake timers stand in for both the
// setTimeout(0) re-entrancy guard the queue uses between tasks and the
// AI_TASK_RETENTION_MS auto-removal window; vi.advanceTimersByTimeAsync
// flushes real microtasks (the run() promises) between each timer step, and
// is called twice per "settle a task, start the next" step to match this
// codebase's existing double-flush pattern for chained setTimeout(0)s (see
// noteInbox.test.ts's settle()).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueAiTask,
  cancelAiTask,
  dismissAiTask,
  getAiTasks,
  subscribeAiTasks,
  __resetAiTaskQueueForTests,
  AI_TASK_RETENTION_MS,
} from "../aiTaskQueue";

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetAiTaskQueueForTests();
  vi.useFakeTimers();
});

describe("enqueueAiTask / serial drain", () => {
  it("runs at most one task at a time and drains queued tasks FIFO", async () => {
    const order: string[] = [];
    const a = deferred<string>();
    const b = deferred<string>();

    const taskA = enqueueAiTask({
      kind: "review",
      title: "A",
      run: async () => {
        order.push("A-start");
        return a.promise;
      },
    });
    const taskB = enqueueAiTask({
      kind: "review",
      title: "B",
      run: async () => {
        order.push("B-start");
        return b.promise;
      },
    });

    // Nothing runs synchronously — draining is scheduled via setTimeout(0).
    expect(getAiTasks().find((t) => t.id === taskA.id)?.status).toBe("queued");
    expect(getAiTasks().find((t) => t.id === taskB.id)?.status).toBe("queued");

    await tick();
    expect(order).toEqual(["A-start"]);
    expect(getAiTasks().find((t) => t.id === taskA.id)?.status).toBe("running");
    expect(getAiTasks().find((t) => t.id === taskB.id)?.status).toBe("queued");

    a.resolve("result-a");
    await tick();
    expect(order).toEqual(["A-start", "B-start"]);
    expect(getAiTasks().find((t) => t.id === taskA.id)?.status).toBe("complete");
    expect(getAiTasks().find((t) => t.id === taskB.id)?.status).toBe("running");

    b.resolve("result-b");
    await tick();
    expect(getAiTasks().find((t) => t.id === taskB.id)?.status).toBe("complete");
  });

  it("stores the resolved value and completes on success", async () => {
    const task = enqueueAiTask({ kind: "chat", title: "t", run: async () => "hello" });
    await tick();
    const found = getAiTasks().find((t) => t.id === task.id)!;
    expect(found.status).toBe("complete");
    expect(found.result).toBe("hello");
    expect(found.finishedAt).toBeDefined();
  });

  it("stores the error message and fails when the run function rejects", async () => {
    const task = enqueueAiTask({
      kind: "chat",
      title: "t",
      run: async () => {
        throw new Error("boom");
      },
    });
    await tick();
    const found = getAiTasks().find((t) => t.id === task.id)!;
    expect(found.status).toBe("failed");
    expect(found.error).toBe("boom");
  });
});

describe("cancelAiTask", () => {
  it("immediately cancels a queued task without running it", async () => {
    let ran = false;
    // Keep the queue busy so the second task stays queued.
    enqueueAiTask({ kind: "x", title: "blocker", run: () => new Promise(() => {}) });
    await tick();

    const queued = enqueueAiTask({
      kind: "x",
      title: "queued",
      run: async () => {
        ran = true;
        return "never";
      },
    });
    expect(getAiTasks().find((t) => t.id === queued.id)?.status).toBe("queued");

    cancelAiTask(queued.id);

    expect(getAiTasks().find((t) => t.id === queued.id)?.status).toBe("cancelled");
    await tick();
    expect(ran).toBe(false);
  });

  it("aborts the run's signal for a running task and settles it as cancelled", async () => {
    let capturedSignal: AbortSignal | undefined;
    const task = enqueueAiTask({
      kind: "x",
      title: "t",
      run: (ctx) =>
        new Promise<string>((_resolve, reject) => {
          capturedSignal = ctx.signal;
          ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    });
    await tick();
    expect(getAiTasks().find((t) => t.id === task.id)?.status).toBe("running");

    cancelAiTask(task.id);
    expect(getAiTasks().find((t) => t.id === task.id)?.status).toBe("cancelling");
    expect(capturedSignal?.aborted).toBe(true);

    await tick();
    expect(getAiTasks().find((t) => t.id === task.id)?.status).toBe("cancelled");
  });
});

describe("dedupe", () => {
  it("returns the existing pending task instead of enqueuing a duplicate", async () => {
    const first = enqueueAiTask({ kind: "x", title: "first", dedupeKey: "k1", run: () => new Promise(() => {}) });
    const second = enqueueAiTask({ kind: "x", title: "second", dedupeKey: "k1", run: () => new Promise(() => {}) });

    expect(second.id).toBe(first.id);
    expect(getAiTasks()).toHaveLength(1);
  });

  it("replaces a retained terminal task sharing the same dedupeKey with the new run", async () => {
    const first = enqueueAiTask({ kind: "x", title: "first", dedupeKey: "k1", retain: true, run: async () => "v1" });
    await tick();
    expect(getAiTasks().find((t) => t.id === first.id)?.status).toBe("complete");

    const second = enqueueAiTask({ kind: "x", title: "second", dedupeKey: "k1", retain: true, run: async () => "v2" });

    expect(second.id).not.toBe(first.id);
    expect(getAiTasks().find((t) => t.id === first.id)).toBeUndefined();
    expect(getAiTasks().some((t) => t.id === second.id)).toBe(true);
  });
});

describe("retention", () => {
  it("removes a non-retained terminal task after AI_TASK_RETENTION_MS", async () => {
    const task = enqueueAiTask({ kind: "x", title: "t", run: async () => "ok" });
    await tick();
    expect(getAiTasks().find((t) => t.id === task.id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(AI_TASK_RETENTION_MS - 1);
    expect(getAiTasks().find((t) => t.id === task.id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(getAiTasks().find((t) => t.id === task.id)).toBeUndefined();
  });

  it("keeps a retained terminal task past the retention window until dismissed", async () => {
    const task = enqueueAiTask({ kind: "x", title: "t", retain: true, run: async () => "ok" });
    await tick();

    await vi.advanceTimersByTimeAsync(AI_TASK_RETENTION_MS + 5000);
    expect(getAiTasks().find((t) => t.id === task.id)).toBeDefined();

    dismissAiTask(task.id);
    expect(getAiTasks().find((t) => t.id === task.id)).toBeUndefined();
  });
});

describe("subscribeAiTasks", () => {
  it("notifies subscribers on every mutation and stops after unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiTasks(listener);

    enqueueAiTask({ kind: "x", title: "t", run: async () => "ok" });
    expect(listener).toHaveBeenCalled();
    const callsAfterEnqueue = listener.mock.calls.length;

    unsubscribe();
    await tick();
    expect(listener.mock.calls.length).toBe(callsAfterEnqueue);
  });
});
