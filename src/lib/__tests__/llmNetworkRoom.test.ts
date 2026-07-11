// Exercises LlmNetworkRoom's join/leave lifecycle and message exchange
// against a fake in-memory network standing in for mistlib's room routing —
// mirrors collab.test.ts's approach, but scoped to LlmNetworkRoom's own
// MistNodeAccess seam (ensure/currentId/onRoomEvent) rather than the raw
// vendored MistNode, since production code registers events through
// mistNode.ts's shared roomId-keyed dispatcher (see mistNode.test.ts),
// not node.onEvent() directly.
import { describe, it, expect, beforeEach } from "vitest";
import { LlmNetworkRoom, type LlmNetworkRoomStatus, type MistNodeAccess } from "../llmNetworkRoom";
import type { NodeEventHandler } from "../mistNode";
import type { MistNode } from "../../vendor/mistlib/wrappers/web/index.js";
import { type ProtocolMessage } from "@tik-choco/mistai";

const EVENT_RAW = 0;
const EVENT_PEER_CONNECTED = 5;
const EVENT_PEER_DISCONNECTED = 6;

interface FakeNode {
  id: string;
  roomHandlers: Map<string, NodeEventHandler>;
  sendMessage(toId: string | null, payload: Uint8Array, _delivery?: number, roomId?: string): void;
  joinRoom(roomId: string): void;
  leaveRoom(roomId?: string): void;
}

const rooms = new Map<string, Set<FakeNode>>();

function getRoom(roomId: string): Set<FakeNode> {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Set();
    rooms.set(roomId, room);
  }
  return room;
}

// One fake node per simulated peer, joined into the shared `rooms` registry —
// each peer's own onRoomEvent stands in for mistNode.ts's per-node dispatcher
// (see mistNode.test.ts for that dispatcher's own coverage).
function makeNodeAccess(id: string): MistNodeAccess {
  const node: FakeNode = {
    id,
    roomHandlers: new Map(),
    sendMessage(toId, payload, _delivery, roomId) {
      if (!roomId) return;
      for (const peer of getRoom(roomId)) {
        if (peer === node) continue;
        if (toId !== null && peer.id !== toId) continue;
        peer.roomHandlers.get(roomId)?.(EVENT_RAW, node.id, payload, roomId);
      }
    },
    joinRoom(roomId) {
      const room = getRoom(roomId);
      const others = Array.from(room);
      room.add(node);
      for (const peer of others) {
        peer.roomHandlers.get(roomId)?.(EVENT_PEER_CONNECTED, node.id, new Uint8Array(), roomId);
        node.roomHandlers.get(roomId)?.(EVENT_PEER_CONNECTED, peer.id, new Uint8Array(), roomId);
      }
    },
    leaveRoom(roomId) {
      if (!roomId) return;
      const room = getRoom(roomId);
      room.delete(node);
      for (const peer of room) {
        peer.roomHandlers.get(roomId)?.(EVENT_PEER_DISCONNECTED, node.id, new Uint8Array(), roomId);
      }
    },
  };
  return {
    ensure: async () => node as unknown as InstanceType<typeof MistNode>,
    currentId: () => id,
    onRoomEvent: (roomId, handler) => {
      node.roomHandlers.set(roomId, handler);
      return () => {
        if (node.roomHandlers.get(roomId) === handler) node.roomHandlers.delete(roomId);
      };
    },
  };
}

beforeEach(() => {
  rooms.clear();
});

describe("LlmNetworkRoom", () => {
  it("joins a room, notifies on peer connect, and exchanges LLM messages", async () => {
    const aMessages: Array<{ fromId: string; msg: ProtocolMessage }> = [];
    const aPeers: string[] = [];
    const a = new LlmNetworkRoom(
      {
        onLlmMessage: (fromId, msg) => aMessages.push({ fromId, msg }),
        onLlmPeerConnected: (peerId) => aPeers.push(peerId),
      },
      makeNodeAccess("a"),
    );
    const b = new LlmNetworkRoom({}, makeNodeAccess("b"));

    await a.join("ai-room");
    await b.join("ai-room");

    expect(aPeers).toEqual(["b"]);

    b.sendLlm(null, { v: 1, type: "consumer_hello" });
    expect(aMessages).toEqual([{ fromId: "b", msg: { v: 1, type: "consumer_hello" } }]);
  });

  it("tracks status through connecting -> joined -> idle", async () => {
    const statuses: LlmNetworkRoomStatus[] = [];
    const a = new LlmNetworkRoom({ onStatusChange: (s) => statuses.push(s) }, makeNodeAccess("a"));

    const joinPromise = a.join("ai-room");
    expect(statuses).toEqual(["connecting"]);
    await joinPromise;
    expect(statuses).toEqual(["connecting", "joined"]);

    a.leave();
    expect(statuses).toEqual(["connecting", "joined", "idle"]);
  });

  it("notifies the peer left behind when a room member leaves, and further sends don't reach it", async () => {
    const bMessages: unknown[] = [];
    const bPeersLeft: string[] = [];
    const a = new LlmNetworkRoom({}, makeNodeAccess("a"));
    const b = new LlmNetworkRoom(
      { onLlmMessage: (fromId) => bMessages.push(fromId), onLlmPeerDisconnected: (peerId) => bPeersLeft.push(peerId) },
      makeNodeAccess("b"),
    );

    await a.join("ai-room");
    await b.join("ai-room");
    a.leave();

    expect(bPeersLeft).toEqual(["a"]);

    a.sendLlm(null, { v: 1, type: "consumer_hello" }); // a's own node dropped this room — no-op, not a leak
    expect(bMessages).toEqual([]);
  });

  it("switching to a different room id leaves the old room and joins the new one", async () => {
    const a = new LlmNetworkRoom({}, makeNodeAccess("a"));
    const oldRoomMessages: unknown[] = [];
    const oldRoomPeer = new LlmNetworkRoom({ onLlmMessage: (fromId) => oldRoomMessages.push(fromId) }, makeNodeAccess("old-peer"));
    const newRoomPeerConnects: string[] = [];
    const newRoomMessages: unknown[] = [];
    const newRoomPeer = new LlmNetworkRoom(
      {
        onLlmPeerConnected: (id) => newRoomPeerConnects.push(id),
        onLlmMessage: (fromId) => newRoomMessages.push(fromId),
      },
      makeNodeAccess("new-peer"),
    );

    await oldRoomPeer.join("room-old");
    await newRoomPeer.join("room-new");
    await a.join("room-old");
    expect(a.currentRoomId).toBe("room-old");

    await a.join("room-new");
    expect(a.currentRoomId).toBe("room-new");
    expect(newRoomPeerConnects).toEqual(["a"]);

    a.sendLlm(null, { v: 1, type: "consumer_hello" });
    expect(newRoomMessages).toEqual(["a"]);
    expect(oldRoomMessages).toEqual([]); // a is no longer in room-old, so its old peer hears nothing
  });

  it("a superseded in-flight join() never clobbers the state a later join()/leave() already set up", async () => {
    // Two joins fired back-to-back before either resolves — only the second
    // (the current desired state) should end up owning the room membership.
    const a = new LlmNetworkRoom({}, makeNodeAccess("a"));
    const first = a.join("room-1");
    const second = a.join("room-2");
    await Promise.all([first, second]);
    expect(a.currentRoomId).toBe("room-2");
  });

  it("destroy() prevents any further join()", async () => {
    const a = new LlmNetworkRoom({}, makeNodeAccess("a"));
    await a.join("ai-room");
    a.destroy();
    await a.join("ai-room-2");
    expect(a.currentRoomId).toBeNull();
  });
});
