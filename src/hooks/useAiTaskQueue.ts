import { useEffect, useState } from "preact/hooks";
import { getAiTasks, subscribeAiTasks, type AiTask } from "../lib/aiTaskQueue";

// preact/hooks has no useSyncExternalStore, so this hand-rolls the same
// subscribe-and-resync pattern used elsewhere in this codebase (see
// useLlmSettings.ts's subscribeLlmConfig effect): read the current snapshot
// eagerly for the initial render, then subscribe and re-read on every
// notification. The effect also re-syncs once on mount, in case the queue's
// state changed in the gap between this component's render and the
// subscription taking effect.
export function useAiTaskQueue(): readonly AiTask[] {
  const [snapshot, setSnapshot] = useState<readonly AiTask[]>(getAiTasks);

  useEffect(() => {
    setSnapshot(getAiTasks());
    return subscribeAiTasks(() => setSnapshot(getAiTasks()));
  }, []);

  return snapshot;
}
