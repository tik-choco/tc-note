import { useCallback, useEffect, useState } from "preact/hooks";
import { type ChatMessage, type ConsumerStatus } from "@tik-choco/mistai";
import { useRoomProviders, type LlmLocalSettings } from "@tik-choco/mistai/preact";
import { resolveModel, roomIdFromBaseUrl, type SharedLlmConfigV1 } from "@tik-choco/mistai/llm-config";
import { rooms } from "../lib/llmRooms";
import { requestTaskChat } from "../lib/llm";

export function useLlmNet({ shared, settings, settingsOpen }: {
  shared: SharedLlmConfigV1; settings: LlmLocalSettings; settingsOpen: boolean;
}) {
  const states = useRoomProviders({
    config: shared, roomProvide: settings.roomProvide, consumers: rooms,
    taskRefs: Object.values(settings.tasks).map(task => task.ref), settingsOpen,
    reasoningEffort: settings.tasks.default?.reasoningEffort ?? "none",
  });
  const target = resolveModel(shared, settings.tasks.default?.ref);
  const roomId = target ? roomIdFromBaseUrl(target.baseUrl) : "";
  const [consumerStatus, setStatus] = useState<ConsumerStatus>({ phase: "idle" });
  useEffect(() => {
    if (!roomId) { setStatus({ phase: "idle" }); return; }
    const client = rooms.roomConsumer(roomId);
    setStatus(client.status);
    return client.onStatusChange(setStatus);
  }, [roomId]);
  const send = useCallback((messages: ChatMessage[], onDelta?: (delta: string, full: string) => void, signal?: AbortSignal) =>
    requestTaskChat(shared, settings.tasks.default, messages, onDelta, signal), [shared, settings.tasks.default]);
  return {
    send, connection: roomId ? "network" as const : "api" as const,
    apiReady: !!target && !roomId, networkAvailable: !!roomId,
    providerCount: consumerStatus.phase === "connected" ? consumerStatus.providers.length : 0,
    consumerStatus, providerModeActive: Object.values(states).some(state => state.status === "connected"),
  };
}
export type UseLlmNetResult = ReturnType<typeof useLlmNet>;
