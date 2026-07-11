// Direct (transport === "api") chat completion against an OpenAI-compatible
// endpoint, streaming the assistant reply delta-by-delta. The SSE plumbing
// lives in @tik-choco/mistai (streamChatCompletion); this module adds the
// app's empty-response guard on top. The target (baseUrl/apiKey/model/
// temperature/reasoningEffort) is @tik-choco/mistai's own OpenAIConfig shape
// — callers pass a resolved shared-config preset (see resolvePreset in
// ./llmConfig.ts) straight through, so per-preset temperature/reasoningEffort
// flow to the upstream call without this module needing to know about them.
//
// Two callers share this:
//   - the chat panel, when connection === "api" (call the resolved preset's
//     endpoint directly);
//   - the LLM-network *provider*, which forwards a peer's llm_request upstream
//     with the same streaming shape so deltas can be relayed back over the
//     collab room chunk-by-chunk (see llmNet.ts / useLlmNet.ts).

import { streamChatCompletion, type ChatMessage, type OpenAIConfig } from "@tik-choco/mistai";

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
  const full = await streamChatCompletion(target, messages, onDelta, fetchFn);

  // streamChatCompletion resolves with "" when the stream carried no content;
  // callers here treat that as a failure, so keep the guard app-side.
  if (!full.trim()) {
    throw new Error("The provider returned an empty response.");
  }

  return full;
}
