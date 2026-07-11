// Exercises mistNode.ts's shared room-event dispatcher: the seam that lets
// collab.ts's session and llmNetworkRoom.ts's dedicated AI Network room
// share the page's one MistNode without one clobbering the other's events
// (mistlib exposes only a single node.onEvent() slot — see mistNode.ts's
// module doc). A fake vendored MistNode stands in for the wasm wrapper so
// this can drive `_onEvent` directly, as if the wasm side had fired an event
// for a given room.
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

describe("mistNode's shared room-event dispatcher", () => {
  it("routes events to the handler registered for their roomId, without either clobbering the other", async () => {
    const { ensureMistNode, onRoomEvent } = await import("../mistNode");
    await ensureMistNode();
    const node = instances[0];

    const roomAEvents: Array<[number, string]> = [];
    const roomBEvents: Array<[number, string]> = [];
    const unregA = onRoomEvent("dispatch-room-a", (eventType, fromId) => roomAEvents.push([eventType, fromId]));
    const unregB = onRoomEvent("dispatch-room-b", (eventType, fromId) => roomBEvents.push([eventType, fromId]));

    node.fire(0, "peer1", new Uint8Array(), "dispatch-room-a");
    node.fire(5, "peer2", new Uint8Array(), "dispatch-room-b");

    expect(roomAEvents).toEqual([[0, "peer1"]]);
    expect(roomBEvents).toEqual([[5, "peer2"]]);
    unregA();
    unregB();
  });

  it("never re-registers node.onEvent() once the dispatcher is installed", async () => {
    const { ensureMistNode } = await import("../mistNode");
    const node = instances[0];
    const handlerBefore = node._onEvent;
    await ensureMistNode();
    await ensureMistNode();
    expect(node._onEvent).toBe(handlerBefore);
  });

  it("unregister stops further dispatch to that room without affecting others", async () => {
    const { onRoomEvent } = await import("../mistNode");
    const node = instances[0];
    const roomEvents: number[] = [];
    const otherEvents: number[] = [];
    onRoomEvent("dispatch-room-other", (eventType) => otherEvents.push(eventType));
    const unregister = onRoomEvent("dispatch-room-c", (eventType) => roomEvents.push(eventType));

    node.fire(0, "peer1", new Uint8Array(), "dispatch-room-c");
    unregister();
    node.fire(0, "peer1", new Uint8Array(), "dispatch-room-c");
    node.fire(1, "peer1", new Uint8Array(), "dispatch-room-other");

    expect(roomEvents).toEqual([0]);
    expect(otherEvents).toEqual([1]);
  });

  it("keeps routing correctly across a full leaveRoom()-triggered teardown and reinit (never a second MistNode)", async () => {
    const { ensureMistNode, onRoomEvent } = await import("../mistNode");
    const node = instances[0];
    const events: number[] = [];
    onRoomEvent("dispatch-room-d", (eventType) => events.push(eventType));

    node.leaveRoom(); // full teardown: no roomId arg, mirrors CollabSession.leave()
    expect(node.initialized).toBe(false);
    await ensureMistNode(); // re-init

    expect(instances).toHaveLength(1); // the singleton is reused, not recreated
    node.fire(0, "peer1", new Uint8Array(), "dispatch-room-d");
    expect(events).toEqual([0]);
  });
});
