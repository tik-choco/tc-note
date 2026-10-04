import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLlmConfig } from "@tik-choco/mistai/llm-config";
const requestRoomChat = vi.hoisted(() => vi.fn().mockResolvedValue("remote answer"));
vi.mock("../llmRooms", () => ({ rooms: { requestRoomChat } }));
import { requestTaskChat } from "../llm";

beforeEach(() => vi.clearAllMocks());
describe("task routing", () => {
  const config = emptyLlmConfig();
  config.providers = [
    { id: "a", label: "Default", baseUrl: "https://default.test/v1", apiKey: "" },
    { id: "b", label: "Selected", baseUrl: "https://selected.test/v1", apiKey: "key" },
    { id: "off", label: "Disabled", baseUrl: "https://disabled.test/v1", apiKey: "", enabled: false },
    { id: "room", label: "Room", baseUrl: "mist-network://second-room", apiKey: "" },
  ];
  config.defaultModel = { providerId: "a", model: "default-model" };
  it("uses the chosen provider and per-task effort, never temperature", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchFn);
    const task = { ref: { providerId: "b", model: "chosen" }, reasoningEffort: "xhigh" as const };
    expect(await requestTaskChat(config, task, [{ role: "user", content: "hello" }])).toBe("answer");
    expect(fetchFn.mock.calls[0][0]).toBe("https://selected.test/v1/chat/completions");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({ model: "chosen", reasoning_effort: "xhigh" });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty("temperature");
    vi.unstubAllGlobals();
  });
  it("falls back only to default for a disabled ref, preserving the stored ref", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"fallback"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })));
    const task = { ref: { providerId: "off", model: "unavailable" }, reasoningEffort: "none" as const };
    expect(await requestTaskChat(config, task, [])).toBe("fallback");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).model).toBe("default-model");
    expect(task.ref.providerId).toBe("off"); vi.unstubAllGlobals();
  });
  it("routes a room ref with task effort and forwards streaming deltas", async () => {
    const onDelta = vi.fn();
    requestRoomChat.mockImplementationOnce(async (_room, _messages, options) => {
      options.onDelta("remote ", "remote ");
      options.onDelta("answer", "remote answer");
      return "remote answer";
    });
    expect(await requestTaskChat(config, { ref: { providerId: "room", model: "raw-model" }, reasoningEffort: "high" }, [], onDelta)).toBe("remote answer");
    expect(requestRoomChat).toHaveBeenCalledWith("second-room", [], {
      model: "raw-model", reasoningEffort: "high", onDelta: expect.any(Function),
    });
    expect(onDelta.mock.calls).toEqual([["remote ", "remote "], ["answer", "remote answer"]]);
  });
  it("sends explicit none when the default room is used without a task", async () => {
    await requestTaskChat({ ...config, defaultModel: { providerId: "room", model: "raw-model" } }, undefined, []);
    expect(requestRoomChat).toHaveBeenCalledWith("second-room", [], {
      model: "raw-model", reasoningEffort: "none", onDelta: expect.any(Function),
    });
  });
  it("errors without a usable default instead of choosing another provider", async () => {
    await expect(requestTaskChat({ ...config, defaultModel: undefined }, undefined, [])).rejects.toMatchObject({ code: "ENDPOINT_NOT_CONFIGURED" });
  });
});
