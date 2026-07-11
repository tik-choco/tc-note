// Verifies CollabSession's real-time sync behaviour (initial sync, live edits,
// concurrent CRDT merges, structural reconciliation, and awareness) against a
// fake in-memory "room" transport that stands in for mistlib's P2P layer.
// mistlib itself is not under test here — only the y-protocols wiring in
// collab.ts is.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CollabSession, peelLegacyEnvelope, type CollabUser, type MistNodeAccess, type PeerInfo } from "../collab";
import { reconcileBlockIds } from "../blockDiff";
import type { MistNode } from "../../vendor/mistlib/wrappers/web/index.js";

// Encodes a value the way bincode's `DefaultOptions` (little-endian varints)
// does, mirroring mistlib-core's overlay/wire.rs — used below to build a
// synthetic double-wrapped OverlayEnvelope the way a pre-fix mistlib wasm
// build (before upstream 99616055) would actually put one on the wire.
function encodeVarint(bytes: number[], n: number): void {
  if (n <= 250) {
    bytes.push(n);
  } else if (n <= 0xffff) {
    bytes.push(251, n & 0xff, (n >> 8) & 0xff);
  } else {
    bytes.push(252, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  }
}

function encodeString(bytes: number[], s: string): void {
  const utf8 = Array.from(new TextEncoder().encode(s));
  encodeVarint(bytes, utf8.length);
  bytes.push(...utf8);
}

// Builds the bytes a pre-fix mistlib wasm build hands to EVENT_RAW: a whole
// serialized OverlayEnvelope (from/to/msg_id/seq/hop_count/content) wrapping
// the real application payload as `MessageContent::Raw` (tag 2).
function doubleWrap(from: string, to: string, payload: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  encodeString(bytes, from);
  encodeString(bytes, to);
  encodeVarint(bytes, 1); // msg_id
  encodeVarint(bytes, 0); // seq
  encodeVarint(bytes, 3); // hop_count
  encodeVarint(bytes, 2); // MessageContent::Raw
  encodeVarint(bytes, payload.length);
  return new Uint8Array([...bytes, ...payload]);
}

// vi.mock's factory is hoisted above this file's own top-level code, so
// everything it references (constants, the fake node class, the shared room
// registry) has to live inside vi.hoisted rather than as ordinary module
// scope declarations.
const {
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
  MockMistNode,
  rooms,
} = vi.hoisted(() => {
  const EVENT_RAW = 0;
  const EVENT_PEER_CONNECTED = 5;
  const EVENT_PEER_DISCONNECTED = 6;
  const DELIVERY_RELIABLE = 0;

  type EventHandler = (eventType: number, fromId: string, payload: Uint8Array) => void;

  const rooms = new Map<string, Set<MockMistNodeType>>();
  function getRoom(roomId: string): Set<MockMistNodeType> {
    let room = rooms.get(roomId);
    if (!room) {
      room = new Set();
      rooms.set(roomId, room);
    }
    return room;
  }

  // One fake node per session, joined into a shared `rooms` map keyed by
  // roomId. sendMessage(toId, payload) delivers synchronously to matching
  // peers in the same room, and joinRoom fires EVENT_PEER_CONNECTED on both
  // the joiner and every existing member — mirroring the symmetric
  // "connection established" callback collab.ts relies on to kick off
  // sync-step1 + full awareness.
  class MockMistNode {
    nodeId: string;
    private roomId: string | null = null;
    private _onEvent: EventHandler | null = null;

    constructor(nodeId: string) {
      this.nodeId = nodeId;
    }

    async init(): Promise<void> {}

    onEvent(handler: EventHandler): void {
      this._onEvent = handler;
    }

    joinRoom(roomId: string): void {
      this.roomId = roomId;
      const room = getRoom(roomId);
      const others = Array.from(room);
      room.add(this);
      for (const peer of others) {
        peer._onEvent?.(EVENT_PEER_CONNECTED, this.nodeId, new Uint8Array());
        this._onEvent?.(EVENT_PEER_CONNECTED, peer.nodeId, new Uint8Array());
      }
    }

    sendMessage(toId: string | null, payload: Uint8Array, _delivery = DELIVERY_RELIABLE): void {
      if (!this.roomId) return;
      const room = getRoom(this.roomId);
      for (const peer of room) {
        if (peer === this) continue;
        if (toId !== null && peer.nodeId !== toId) continue;
        peer._onEvent?.(EVENT_RAW, this.nodeId, payload);
      }
    }

    leaveRoom(): void {
      if (!this.roomId) return;
      const room = getRoom(this.roomId);
      room.delete(this);
      for (const peer of room) {
        peer._onEvent?.(EVENT_PEER_DISCONNECTED, this.nodeId, new Uint8Array());
      }
      this.roomId = null;
    }
  }
  type MockMistNodeType = InstanceType<typeof MockMistNode>;

  return { EVENT_RAW, EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED, DELIVERY_RELIABLE, MockMistNode, rooms };
});

vi.mock("../../vendor/mistlib/wrappers/web/index.js", () => ({
  MistNode: MockMistNode,
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
}));

function makeId(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

// Production code funnels every consumer through one shared page-wide
// MistNode (see mistNode.ts — mistlib-wasm allows only one active node per
// page). These tests simulate several independent peers within a single
// process, so each needs its own fake node instead of sharing one; this
// stands in for CollabSession's default node access accordingly.
function makeNodeAccess(id: string): MistNodeAccess {
  // MockMistNode only implements the handful of members CollabSession
  // actually calls, not the full real MistNode surface (media tracks,
  // positioning, stats, ...) — the cast reflects that this is a test double,
  // not a claim that the two are structurally identical.
  let nodePromise: Promise<InstanceType<typeof MistNode>> | null = null;
  return {
    ensure: async () => {
      if (!nodePromise) {
        nodePromise = (async () => {
          const node = new MockMistNode(id);
          await node.init();
          return node as unknown as InstanceType<typeof MistNode>;
        })();
      }
      return nodePromise;
    },
    currentId: () => id,
  };
}

const ALICE: CollabUser = { name: "Alice", color: "#ff0000" };
const BOB: CollabUser = { name: "Bob", color: "#00ff00" };

beforeEach(() => {
  rooms.clear();
});

describe("CollabSession real-time sync", () => {
  it("syncs existing content to a peer that joins later", async () => {
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    await a.join("room1");
    a.transact(() => {
      a.order.push(["b1"]);
      a.blockContents.set("b1", "hello from A");
    });

    const b = new CollabSession(BOB, {}, makeNodeAccess("b"));
    await b.join("room1");

    expect(b.order.toArray()).toEqual(["b1"]);
    expect(b.blockContents.get("b1")).toBe("hello from A");

    a.destroy();
    b.destroy();
  });

  it("propagates a live edit to an already-connected peer", async () => {
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    const b = new CollabSession(BOB, {}, makeNodeAccess("b"));
    await a.join("room1");
    await b.join("room1");

    a.transact(() => {
      a.order.push(["b1"]);
      a.blockContents.set("b1", "v1");
    });
    expect(b.blockContents.get("b1")).toBe("v1");

    a.transact(() => {
      a.blockContents.set("b1", "v2");
    });
    expect(b.blockContents.get("b1")).toBe("v2");

    a.destroy();
    b.destroy();
  });

  it("merges concurrent edits to different blocks without data loss", async () => {
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    const b = new CollabSession(BOB, {}, makeNodeAccess("b"));
    await a.join("room1");
    await b.join("room1");

    a.transact(() => {
      a.order.push(["b1", "b2"]);
      a.blockContents.set("b1", "orig1");
      a.blockContents.set("b2", "orig2");
    });
    expect(b.order.toArray()).toEqual(["b1", "b2"]);

    a.transact(() => {
      a.blockContents.set("b1", "edited by A");
    });
    b.transact(() => {
      b.blockContents.set("b2", "edited by B");
    });

    for (const doc of [a, b]) {
      expect(doc.blockContents.get("b1")).toBe("edited by A");
      expect(doc.blockContents.get("b2")).toBe("edited by B");
    }

    a.destroy();
    b.destroy();
  });

  it("propagates block insert/delete computed via reconcileBlockIds", async () => {
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    const b = new CollabSession(BOB, {}, makeNodeAccess("b"));
    await a.join("room1");
    await b.join("room1");

    const nextId = makeId();
    a.transact(() => {
      a.order.push(["b1", "b2"]);
      a.blockContents.set("b1", "one");
      a.blockContents.set("b2", "two");
    });
    expect(b.order.toArray()).toEqual(["b1", "b2"]);

    // Insert a block between "one" and "two", then delete "one" — two
    // separate block-count changes, so reconcileBlockIds takes the LCS path
    // (not the same-length positional fast path) for each.
    function applyReconcile(nextValues: string[]): ReturnType<typeof reconcileBlockIds> {
      const prevIds = a.order.toArray();
      const prevValues = prevIds.map((id) => a.blockContents.get(id)!);
      const result = reconcileBlockIds(prevIds, prevValues, nextValues, nextId);
      a.transact(() => {
        for (const op of result.orderOps) {
          if (op.type === "delete") {
            a.order.delete(op.index, op.count);
          } else {
            a.order.insert(op.index, op.ids);
          }
        }
        for (const write of result.contentWrites) {
          a.blockContents.set(write.id, write.value);
        }
        for (const id of result.removedIds) {
          a.blockContents.delete(id);
        }
      });
      return result;
    }

    const inserted = applyReconcile(["one", "inserted", "two"]);
    expect(inserted.orderOps).toEqual([{ type: "insert", index: 1, ids: [inserted.ids[1]] }]);
    expect(b.order.toArray()).toEqual(inserted.ids);
    expect(b.blockContents.get(inserted.ids[1])).toBe("inserted");

    const deleted = applyReconcile(["inserted", "two"]);
    expect(deleted.orderOps).toEqual([{ type: "delete", index: 0, count: 1 }]);
    expect(b.order.toArray()).toEqual(deleted.ids);
    expect(b.blockContents.get("b1")).toBeUndefined();

    a.destroy();
    b.destroy();
  });

  it("shares user name/color through awareness", async () => {
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    let bPeers: PeerInfo[] = [];
    const b = new CollabSession(BOB, { onPeersChange: (peers) => (bPeers = peers) }, makeNodeAccess("b"));

    await a.join("room1");
    await b.join("room1");

    const alicePeer = bPeers.find((p) => p.clientId === a.localClientId);
    expect(alicePeer?.name).toBe("Alice");
    expect(alicePeer?.color).toBe("#ff0000");

    a.destroy();
    b.destroy();
  });
});

describe("peelLegacyEnvelope (mistlib-dev#16 double-wrap compat)", () => {
  it("extracts the inner payload from a double-wrapped OverlayEnvelope", () => {
    const inner = new Uint8Array([0, 1, 2, 3, 4]); // e.g. a MSG_SYNC frame
    const wrapped = doubleWrap("peer-a", "peer-b", inner);
    expect(peelLegacyEnvelope(wrapped)).toEqual(inner);
  });

  it("returns null for a genuine (already-fixed) raw frame", () => {
    // A real MSG_SYNC/MSG_AWARENESS/MSG_LLM frame starts with a 1-byte tag
    // (0/1/2) and has no valid envelope structure behind it.
    const raw = new Uint8Array([0, 42, 7]);
    expect(peelLegacyEnvelope(raw)).toBeNull();
  });

  it("returns null for garbage that doesn't parse as a full envelope", () => {
    expect(peelLegacyEnvelope(new Uint8Array([255, 255, 255]))).toBeNull();
    expect(peelLegacyEnvelope(new Uint8Array())).toBeNull();
  });

  it("syncs across a peer still on the pre-fix (double-wrapping) mistlib build", async () => {
    // Simulates a not-yet-upgraded peer: everything it sends over the wire
    // is wrapped in an extra OverlayEnvelope layer, same as a real pre-fix
    // mistlib wasm build. Broadcast traffic (what doc/awareness updates use)
    // should still get through once peelLegacyEnvelope strips the layer back
    // off, even though this session is on the fixed build.
    const bAccess = makeNodeAccess("b");
    const a = new CollabSession(ALICE, {}, makeNodeAccess("a"));
    const b = new CollabSession(BOB, {}, bAccess);
    await a.join("room1");
    await b.join("room1");

    // Wrap every payload b's underlying node relays to a, mimicking b being
    // stuck on the old build while a already upgraded.
    const bNode = await bAccess.ensure();
    const originalSend = bNode.sendMessage.bind(bNode);
    bNode.sendMessage = ((toId: string | null, payload: Uint8Array, delivery?: number) => {
      originalSend(toId, doubleWrap("b", toId ?? "*", payload), delivery);
    }) as typeof bNode.sendMessage;

    a.transact(() => {
      a.order.push(["b1"]);
      a.blockContents.set("b1", "hello from A");
    });
    expect(b.blockContents.get("b1")).toBe("hello from A");

    b.transact(() => {
      b.blockContents.set("b1", "hello from B (double-wrapped)");
    });
    expect(a.blockContents.get("b1")).toBe("hello from B (double-wrapped)");

    a.destroy();
    b.destroy();
  });
});
