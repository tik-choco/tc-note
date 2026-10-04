import { MistaiError, streamChatCompletion, type ChatMessage, type OpenAIConfig } from "@tik-choco/mistai";
import { resolveModel, roomIdFromBaseUrl, type SharedLlmConfigV1 } from "@tik-choco/mistai/llm-config";
import type { TaskModelV1 } from "@tik-choco/mistai/preact";
import { rooms } from "./llmRooms";

/**
 * Streams a chat completion from `target`'s `/chat/completions` endpoint.
 * `onDelta` receives each non-empty content delta as it arrives; the full
 * assembled text is returned.
 *
 * `signal`, when given, aborts the underlying request: streamChatCompletion's
 * 4th parameter is a fetchFn (`typeof fetch`), so an AbortSignal is threaded
 * through by wrapping the ambient `fetch` with one that carries it, rather
 * than by streamChatCompletion accepting a signal directly. Used by the
 * background AI task queue (lib/aiTaskQueue.ts) to cancel an in-flight call
 * when a task is cancelled.
 *
 * Throws a MistaiError (UPSTREAM_REQUEST_FAILED / UPSTREAM_HTTP_ERROR /
 * UPSTREAM_BAD_RESPONSE) on transport failures — see @tik-choco/mistai.
 */
export async function requestApiChatCompletionStreaming(
  target: OpenAIConfig,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const fetchFn: typeof fetch | undefined = signal
    ? (input, init) => fetch(input, { ...init, signal })
    : undefined;
  const full = await streamChatCompletion({
    baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model,
    reasoningEffort: target.reasoningEffort,
  }, messages, onDelta, fetchFn);

  // streamChatCompletion resolves with "" when the stream carried no content;
  // callers here treat that as a failure, so keep the guard app-side.
  if (!full.trim()) {
    throw new Error("The provider returned an empty response.");
  }

  return full;
}

export async function requestTaskChat(
  config: SharedLlmConfigV1, task: TaskModelV1 | undefined, messages: ChatMessage[],
  onDelta?: (delta: string, full: string) => void, signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const target = resolveModel(config, task?.ref);
  if (!target) throw new MistaiError("ENDPOINT_NOT_CONFIGURED", "No usable model configured.");
  const roomId = roomIdFromBaseUrl(target.baseUrl);
  if (roomId) {
    const request = rooms.requestRoomChat(roomId, messages, {
      model: target.model,
      reasoningEffort: task?.reasoningEffort ?? "none",
      onDelta: (delta, full) => {
        if (!signal?.aborted) onDelta?.(delta, full);
      },
    });
    if (!signal) return request;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  let full = "";
  return requestApiChatCompletionStreaming({ ...target, reasoningEffort: task?.reasoningEffort ?? "none" }, messages, delta => {
    full += delta; onDelta?.(delta, full);
  }, signal);
}
