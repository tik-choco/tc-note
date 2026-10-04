import { describe, it, expect, beforeAll, vi } from "vitest";

type FakeEventHandler = (eventType: number, fromId: string, payload: unknown, roomId: string) => void;

const { MockMistNode, instances } = vi.hoisted(() => {
  const instances: MockMistNodeType[] = [];

  class MockMistNode {
    nodeId: string;
    initialized = false;
    _onEvent: FakeEventHandler | null = null;

    constructor(nodeId: string) {
      this.nodeId = nodeId;
      instances.push(this);
    }

    async init(): Promise<void> {
      this.initialized = true;
    }

    onEvent(handler: FakeEventHandler): void {
      this._onEvent = handler;
    }

    joinRoom(_roomId: string): void {}
    async joinRoomAsync(roomId: string): Promise<void> { this.joinRoom(roomId); }

    // Mirrors the real wrapper: leaveRoom(roomId) drops just that room;
    // leaveRoom() with no argument fully decommissions the node.
    leaveRoom(roomId?: string): void {
      if (roomId) return;
      this.initialized = false;
    }

    sendMessage(): void {}

    /** Test helper: simulates the wasm side firing an event for `roomId`. */
    fire(eventType: number, fromId: string, payload: unknown, roomId: string): void {
      this._onEvent?.(eventType, fromId, payload, roomId);
    }
  }
  type MockMistNodeType = InstanceType<typeof MockMistNode>;

  return { MockMistNode, instances };
});

vi.mock("../../vendor/mistlib/wrappers/web/index.js", () => ({ MistNode: MockMistNode }));

// mistNode.ts's getPageNodeId() reads/writes localStorage on first use.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeAll(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
});

describe("mistai node bridge", () => {
  it("initializes storage only once and preserves the event slot", async () => {
    const { ensureMistNode } = await import("../mistNode");
    const [a, b] = await Promise.all([ensureMistNode(), ensureMistNode()]);
    expect(a).toBe(b); expect(instances).toHaveLength(1);
    const handler = instances[0]._onEvent;
    await ensureMistNode(); expect(instances[0]._onEvent).toBe(handler);
  });
  it("shares collab, consumer and provider memberships without leaving another room or tearing down storage", async () => {
    const { createSharedMistNode, currentNodeId } = await import("../mistNode");
    const node = instances[0];
    const leave = vi.spyOn(node, "leaveRoom");
    const send = vi.spyOn(node, "sendMessage");
    const collab = createSharedMistNode(currentNodeId());
    const consumer = createSharedMistNode(currentNodeId());
    const provider = createSharedMistNode(currentNodeId());
    await Promise.all([collab.init(), consumer.init(), provider.init()]);
    await Promise.all([collab.joinRoom("shared-room"), consumer.joinRoom("shared-room"), provider.joinRoom("second-room")]);
    const events: string[] = [];
    consumer.onEvent((_type, from) => events.push(from));
    node.fire(0, "second-peer", new Uint8Array(), "second-room");
    node.fire(0, "shared-peer", new Uint8Array(), "shared-room");
    expect(events).toEqual(["shared-peer"]);
    collab.leaveRoom(); expect(leave).not.toHaveBeenCalled();
    const bytes = new Uint8Array([1]); provider.sendMessage(null, bytes, 0);
    expect(send).toHaveBeenLastCalledWith(null, bytes, 0, "second-room");
    consumer.leaveRoom(); expect(leave).toHaveBeenCalledWith("shared-room");
    provider.leaveRoom(); expect(leave).toHaveBeenCalledWith("second-room");
    expect(node.initialized).toBe(true); expect(instances).toHaveLength(1);
  });
});
