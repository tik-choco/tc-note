import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode, encode, type MistNodeLike, type ProtocolMessage } from "@tik-choco/mistai";
import { emptyLlmConfig } from "@tik-choco/mistai/llm-config";

const createSharedMistNode = vi.hoisted(() => vi.fn());
vi.mock("../mistNode", () => ({ createSharedMistNode }));
import { rooms } from "../llmRooms";
import { requestTaskChat } from "../llm";

// Exercise the app's room scope with real mistai consumers and an in-memory peer.
class PeerNode implements MistNodeLike {
  sent: ProtocolMessage[] = [];
  handler?: Parameters<MistNodeLike["onEvent"]>[0];
  async init() {}
  onEvent(handler: Parameters<MistNodeLike["onEvent"]>[0]) { this.handler = handler; }
  joinRoom() {
    this.receive({ v: 1, type: "provider_hello", services: ["chat", "oai"], models: ["raw-model"] });
  }
  leaveRoom() {}
  sendMessage(_to: string | null | undefined, payload: Uint8Array) {
    const message = decode(payload);
    if (message) this.sent.push(message);
  }
  receive(message: ProtocolMessage) { this.handler?.(0, "provider", encode(message)); }
}

let node: PeerNode;
beforeEach(() => {
  node = new PeerNode();
  createSharedMistNode.mockReturnValue(node);
  // Room consumers only need getItem/setItem for their persistent node id.
  vi.stubGlobal("localStorage", { getItem: () => "test-node", setItem: vi.fn() });
});
afterEach(() => {
  rooms.disconnectRoom("test-room");
  vi.unstubAllGlobals();
});

describe("app room transport", () => {
  it("sends task reasoning_effort on llm_request and streams before completion", async () => {
    const config = emptyLlmConfig();
    config.providers = [{ id: "room", label: "Room", baseUrl: "mist-network://test-room", apiKey: "" }];
    const messages = [{ role: "user" as const, content: "hello" }];
    const onDelta = vi.fn();
    const chat = vi.spyOn(rooms, "requestRoomChat");
    const pending = requestTaskChat(config, {
      ref: { providerId: "room", model: "raw-model" }, reasoningEffort: "max",
    }, messages, onDelta);
    try {
      await vi.waitFor(() => expect(node.sent.some(msg => msg.type === "llm_request")).toBe(true));
      const request = node.sent.find(msg => msg.type === "llm_request")!;
      expect(chat).toHaveBeenCalledWith("test-room", messages, {
        model: "raw-model", reasoningEffort: "max", onDelta: expect.any(Function),
      });
      expect(request).toMatchObject({ type: "llm_request", model: "raw-model", messages, reasoning_effort: "max" });
      expect(request).not.toHaveProperty("temperature");
      expect(node.sent.some(msg => msg.type === "oai_request")).toBe(false);
      node.receive({ v: 1, type: "llm_response_chunk", id: request.id, seq: 0, delta: "first " });
      expect(onDelta).toHaveBeenLastCalledWith("first ", "first ");
      node.receive({ v: 1, type: "llm_response_chunk", id: request.id, seq: 1, delta: "second" });
      expect(onDelta.mock.calls).toEqual([["first ", "first "], ["second", "first second"]]);
      node.receive({ v: 1, type: "llm_response_done", id: request.id });
      expect(await pending).toBe("first second");
    } finally {
      chat.mockRestore();
    }
  });

  it("preserves image content parts for vision/OCR through the room tunnel", async () => {
    // tc-note imports OCR results; the room scope retains the tunnel for image requests.
    const body = JSON.stringify({ model: "raw-model", messages: [{ role: "user", content: [
      { type: "text", text: "Read this image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    ] }], reasoning_effort: "high" });
    const pending = rooms.requestRoomOpenAi("test-room", {
      path: "/chat/completions", method: "POST", contentType: "application/json", body,
    });
    await vi.waitFor(() => expect(node.sent.some(msg => msg.type === "oai_request")).toBe(true));
    const request = node.sent.find(msg => msg.type === "oai_request")!;
    expect(request).toMatchObject({ path: "/chat/completions", method: "POST", contentType: "application/json" });
    expect(atob(request.data)).toBe(body);
    expect(node.sent.some(msg => msg.type === "llm_request")).toBe(false);
    const response = JSON.stringify({ choices: [{ message: { content: "OCR text" } }] });
    node.receive({ v: 1, type: "oai_response", id: request.id, seq: 0, last: true,
      status: 200, contentType: "application/json", data: btoa(response) });
    expect(await pending).toEqual({ status: 200, contentType: "application/json", body: response });
  });
});
