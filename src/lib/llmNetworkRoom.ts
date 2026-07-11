// A dedicated mistlib room used purely for AI Network traffic (see
// llmNet.ts / useLlmNet.ts) when there's no active collab session to
// piggyback on. Lets "network" mode work standalone: the user sets a Room ID
// in AI Network settings and this module joins it directly.
//
// Unlike collab.ts's room — which multiplexes Yjs sync, awareness, and LLM
// traffic under a 1-byte MSG_* prefix so all three can share mistlib's single
// message channel — this room carries *only* LLM protocol messages, so no
// framing prefix is needed: encodeLlm's bytes go on the wire as-is.
//
// Joins/leaves the page's single shared MistNode (mistNode.ts) rather than
// creating its own — mistlib-wasm allows exactly one active node per page
// (see mistNode.ts's module doc). The node itself *can* be a member of
// several rooms at once, so in principle this room could stay joined
// alongside an active collab room; useLlmNet.ts deliberately doesn't do that
// (see its module doc) — it treats the collab room and this dedicated room as
// mutually exclusive AI Network transports, always preferring collab when a
// session is active, to keep exactly one LlmNet's worth of provider/consumer
// state live at a time instead of merging two independent peer sets into one
// UI. Event delivery is still routed through mistNode.ts's roomId-keyed
// dispatcher (rather than calling node.onEvent() here directly) so this can
// never clobber whatever collab.ts has registered for its own room, even
// during the brief overlap of a leave-then-join hand-off.
import {
  DELIVERY_RELIABLE,
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  type MistNode,
} from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode, currentNodeId, onRoomEvent, type NodeEventHandler } from "./mistNode";
import { decode as decodeLlm, encode as encodeLlm, type ProtocolMessage } from "@tik-choco/mistai";
import type { LlmNetTransport } from "./llmNet";

export type LlmNetworkRoomStatus = "idle" | "connecting" | "joined" | "error";

export interface LlmNetworkRoomCallbacks {
  onStatusChange?: (status: LlmNetworkRoomStatus) => void;
  onLlmMessage?: (fromId: string, msg: ProtocolMessage) => void;
  onLlmPeerConnected?: (peerId: string) => void;
  onLlmPeerDisconnected?: (peerId: string) => void;
}

// Same seam as collab.ts's MistNodeAccess — overridable purely for tests.
export interface MistNodeAccess {
  ensure(): Promise<InstanceType<typeof MistNode>>;
  currentId(): string;
  onRoomEvent(roomId: string, handler: NodeEventHandler): () => void;
}

const defaultNodeAccess: MistNodeAccess = {
  ensure: ensureMistNode,
  currentId: currentNodeId,
  onRoomEvent,
};

/**
 * Lifecycle + transport for the dedicated AI Network room. One instance is
 * meant to live for the whole app session (see useLlmNet.ts): call join()
 * whenever the desired room id changes, leave() to drop it (e.g. a collab
 * session just took over), and destroy() once when the owning hook unmounts.
 */
export class LlmNetworkRoom implements LlmNetTransport {
  private readonly callbacks: LlmNetworkRoomCallbacks;
  private readonly nodeAccess: MistNodeAccess;

  private node: InstanceType<typeof MistNode> | null = null;
  private roomId: string | null = null;
  private status: LlmNetworkRoomStatus = "idle";
  private unregister: (() => void) | null = null;
  // Bumped by every join()/leave() call; an in-flight join() checks its own
  // captured value against the current one before applying its result, so a
  // join superseded by a later join/leave (roomId changed again, or the
  // dedicated room was abandoned in favor of collab) never clobbers state a
  // newer call already set up.
  private generation = 0;
  private destroyed = false;

  constructor(callbacks: LlmNetworkRoomCallbacks = {}, nodeAccess: MistNodeAccess = defaultNodeAccess) {
    this.callbacks = callbacks;
    this.nodeAccess = nodeAccess;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  get currentStatus(): LlmNetworkRoomStatus {
    return this.status;
  }

  private setStatus(status: LlmNetworkRoomStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  /** Joins `roomId`, leaving whatever room this instance was previously in. No-op if already joined to it. */
  async join(roomId: string): Promise<void> {
    if (this.destroyed || (this.roomId === roomId && this.node)) return;
    this.leaveInternal();
    const generation = ++this.generation;
    this.setStatus("connecting");
    try {
      const node = await this.nodeAccess.ensure();
      if (this.destroyed || generation !== this.generation) return; // superseded meanwhile
      this.node = node;
      this.roomId = roomId;
      this.unregister = this.nodeAccess.onRoomEvent(roomId, (eventType, fromId, payload) => {
        if (this.node !== node || this.roomId !== roomId) return;
        if (eventType === EVENT_RAW) {
          const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
          const msg = decodeLlm(bytes);
          if (msg) this.callbacks.onLlmMessage?.(fromId, msg);
        } else if (eventType === EVENT_PEER_CONNECTED) {
          this.callbacks.onLlmPeerConnected?.(fromId);
        } else if (eventType === EVENT_PEER_DISCONNECTED) {
          this.callbacks.onLlmPeerDisconnected?.(fromId);
        }
      });
      node.joinRoom(roomId);
      this.setStatus("joined");
    } catch (err) {
      if (this.destroyed || generation !== this.generation) return;
      this.setStatus("error");
      throw err;
    }
  }

  /** Sends an LLM protocol message over this room, scoped by roomId so it never leaks onto another room the shared node belongs to. */
  sendLlm(toId: string | null, msg: ProtocolMessage): void {
    if (!this.node || !this.roomId) return;
    this.node.sendMessage(toId, encodeLlm(msg), DELIVERY_RELIABLE, this.roomId);
  }

  private leaveInternal(): void {
    this.unregister?.();
    this.unregister = null;
    // Targeted leave (this room only) — never the whole node, which a collab
    // session or note storage may still need (see mistNode.ts).
    if (this.node && this.roomId) this.node.leaveRoom(this.roomId);
    this.node = null;
    this.roomId = null;
  }

  /** Leaves the current room, if any. Safe to call again later with join() — this instance stays reusable. */
  leave(): void {
    if (this.status === "idle" && !this.node) return;
    this.generation++; // invalidate any in-flight join()
    this.leaveInternal();
    this.setStatus("idle");
  }

  /** Final teardown — this instance must not be reused after calling this. */
  destroy(): void {
    this.leave();
    this.destroyed = true;
  }
}
