// Real-time collaborative editing session: binds a Yjs document (blocks +
// title) to mistlib's P2P transport. mistlib itself is just a raw-message
// pipe — this module layers y-protocols' sync/awareness protocols on top,
// each message tagged with a 1-byte type prefix so both protocols can share
// mistlib's single onRawMessage channel.
//
// mistlib only exposes one event slot at a time (onEvent/onRawMessage both
// just replace `_onEvent`), so we register one onEvent handler here that
// dispatches on eventType ourselves instead of trying to use both helpers.

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  MistNode,
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
} from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode, currentNodeId, onRoomEvent, type NodeEventHandler } from "./mistNode";
import { decode as decodeLlm, encode as encodeLlm, type ProtocolMessage } from "@tik-choco/mistai";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
// LLM-network traffic (see llmNet.ts) rides this same room rather than
// spinning up a second MistNode — the page only allows one (mistNode.ts).
// Tagged with its own 1-byte prefix alongside MSG_SYNC/MSG_AWARENESS so all
// three protocols share mistlib's single onEvent/raw-message channel.
const MSG_LLM = 2;

// Tags updates originating from this session's own Yjs transactions, so the
// update-broadcast listener can tell them apart from updates applied while
// replaying a message that arrived over the network (which must not be
// re-broadcast, or peers would echo messages back and forth forever).
const LOCAL_ORIGIN = Symbol("collab-local");
// Tags updates/awareness changes applied while decoding a message that just
// arrived from a peer, so they're never mistaken for local edits and
// rebroadcast (which would echo every message around the room indefinitely).
const REMOTE_ORIGIN = Symbol("collab-remote");

// --- Legacy double-wrap compat (mistlib-dev#16 / upstream fix 99616055) ---
// A peer still running a pre-fix mistlib wasm build double-wraps every
// send_message payload in a bincode OverlayEnvelope: send_via_ctx wraps the
// app bytes once via overlay.wrap_data, then hands the *already-wrapped*
// result to ctx.transport, whose send()/broadcast() wrap it again. The
// receiving engine only unwraps the outer layer, so EVENT_RAW hands us the
// inner envelope's serialized bytes instead of our own frame. Unicast
// messages from such peers are lost regardless (the double wrap also burns
// two reorder-buffer sequence numbers per send, jamming ReliableOrdered
// unicast), but broadcast traffic — which is what this session's doc/
// awareness updates actually use (sendMessage(null, ...)) — still arrives,
// so it's worth peeling the extra layer back off here rather than silently
// dropping every message from a not-yet-upgraded peer.
//
// Layout (bincode 1.3 `DefaultOptions`: little-endian varints, reject
// trailing bytes — see mistlib-core's overlay/wire.rs "Envelope v4") of
// mistlib-core's `OverlayEnvelope`:
//
//   from:      NodeId(String)   -> varint len + UTF-8 bytes
//   to:        NodeId(String)   -> varint len + UTF-8 bytes
//   msg_id:    u64 varint
//   seq:       u64 varint
//   hop_count: u32 varint
//   content:   MessageContent   -> u32 varint tag (2 = Raw) + varint len + bytes
//
// Returns null unless the buffer parses as a structurally exact envelope
// (every length in bounds, tag is Raw, payload consumes exactly the
// remainder) — a genuine (already-fixed-peer) raw frame practically never
// satisfies that, since ours always starts with a 1-byte MSG_* tag (0/1/2),
// not a plausible NodeId length.
const ENVELOPE_ID_MAX_LEN = 256;

export function peelLegacyEnvelope(bytes: Uint8Array): Uint8Array | null {
  let off = 0;

  function readVarint(): number | null {
    if (off >= bytes.length) return null;
    const tag = bytes[off++];
    if (tag <= 250) return tag;
    if (tag === 251) {
      if (off + 2 > bytes.length) return null;
      const v = bytes[off] | (bytes[off + 1] << 8);
      off += 2;
      return v;
    }
    if (tag === 252) {
      if (off + 4 > bytes.length) return null;
      const v = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true);
      off += 4;
      return v;
    }
    if (tag === 253) {
      if (off + 8 > bytes.length) return null;
      const v = new DataView(bytes.buffer, bytes.byteOffset + off, 8).getBigUint64(0, true);
      off += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
    }
    return null; // 254/255: u128 / extension point, never used here
  }

  function skipString(): boolean {
    const len = readVarint();
    if (len === null || len > ENVELOPE_ID_MAX_LEN || off + len > bytes.length) return false;
    off += len;
    return true;
  }

  if (!skipString()) return null; // from
  if (!skipString()) return null; // to
  if (readVarint() === null) return null; // msg_id
  if (readVarint() === null) return null; // seq
  if (readVarint() === null) return null; // hop_count
  if (readVarint() !== 2) return null; // content tag: MessageContent::Raw
  const len = readVarint();
  if (len === null || off + len !== bytes.length) return null;
  return bytes.subarray(off);
}

export interface CollabUser {
  name: string;
  color: string;
}

export interface PeerInfo {
  clientId: number;
  name: string;
  color: string;
  activeBlock: number | null;
}

export type CollabStatus = "idle" | "connecting" | "connected" | "error";

// Room ids are either generated (crypto.randomUUID()) or pasted in by hand
// via the "join by room ID" field — keep the accepted shape narrow so
// obviously-garbled input (whitespace, stray URL fragments, etc.) is
// rejected before it ever reaches mistlib's joinRoom().
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}

// Defensive clamps applied to any identity data that can come from outside
// this session's own control — a remote peer's awareness state, or a
// previously-stored local identity read back out of localStorage. Neither
// is trusted input in the security sense (this is P2P, not a server
// boundary), but a corrupted/adversarial value here could still blow up
// layout (an unbounded name) or fail silently in a `style` binding (a
// non-color string), so both are normalized to a safe fallback.
const NAME_MAX_LEN = 40;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const FALLBACK_COLOR = "#888888";

export function clampUserName(name: string): string {
  const trimmed = name.trim().slice(0, NAME_MAX_LEN);
  return trimmed || "Anonymous";
}

export function normalizeColor(color: string): string {
  return COLOR_PATTERN.test(color) ? color : FALLBACK_COLOR;
}

export interface CollabCallbacks {
  onStatusChange?: (status: CollabStatus) => void;
  onPeersChange?: (peers: PeerInfo[]) => void;
  /** Fired after any doc mutation (local or remote) so the caller can re-derive its own state. */
  onDocChange?: () => void;
  // --- LLM network (see llmNet.ts) ---------------------------------------
  // These ride the same room as sync/awareness. They're usually attached
  // after construction via setLlmCallbacks() (the LLM orchestration lives in
  // useLlmNet, separate from whoever creates the session), but they live on
  // CollabCallbacks so the whole message surface is documented in one place.
  /** A decoded, validated LLM protocol message arrived from `fromId`. */
  onLlmMessage?: (fromId: string, msg: ProtocolMessage) => void;
  /** A peer joined the room — the provider uses this to send provider_hello. */
  onLlmPeerConnected?: (peerId: string) => void;
  /** A peer left the room — the consumer uses this to forget a lost provider. */
  onLlmPeerDisconnected?: (peerId: string) => void;
}

interface AwarenessState {
  peerId: string;
  name: string;
  color: string;
  activeBlock: number | null;
}

// How a CollabSession obtains the page's mistlib node — the real
// implementation adopts the one shared MistNode (see mistNode.ts, and the
// "one active MistNode per page" note on join() below). Overridable purely
// for tests, which simulate multiple independent peers within a single
// process and so need each simulated peer to have its own fake node.
export interface MistNodeAccess {
  ensure(): Promise<InstanceType<typeof MistNode>>;
  currentId(): string;
  /**
   * Registers a room-scoped event handler on the shared node instead of
   * calling node.onEvent() directly (see mistNode.ts — the node exposes only
   * one event slot, but may belong to several rooms at once, e.g. this
   * session's room alongside llmNetworkRoom.ts's dedicated AI Network room).
   * Optional: test doubles give each simulated peer its own node, so
   * per-room multiplexing on a shared node is a production-only concern —
   * when omitted, join() falls back to calling node.onEvent() itself.
   */
  onRoomEvent?(roomId: string, handler: NodeEventHandler): () => void;
}

const defaultNodeAccess: MistNodeAccess = {
  ensure: ensureMistNode,
  currentId: currentNodeId,
  onRoomEvent,
};

// One CollabSession per open note. Owns the Y.Doc, awareness instance, and
// the mistlib node for the room; destroy() tears all of it down cleanly.
export class CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  /** Ordered list of block ids — the block model's index order. */
  readonly order = this.doc.getArray<string>("order");
  /** Block id -> its markdown content. Keyed so concurrent edits to
   * different blocks touch different Yjs entries instead of racing over one
   * whole-document value. */
  readonly blockContents = this.doc.getMap<string>("blockContents");
  readonly meta = this.doc.getMap<string>("meta");

  private node: InstanceType<typeof MistNode> | null = null;
  private nodeId: string | null = null;
  private roomId: string | null = null;
  // Set when join() registers through nodeAccess.onRoomEvent (the production
  // path) rather than claiming node.onEvent() directly — called on leave() so
  // a later join (this session's, or the dedicated LLM room's) never lands on
  // a stale handler for this room id.
  private unregisterRoomEvent: (() => void) | null = null;
  private status: CollabStatus = "idle";
  private disposed = false;
  private peerIdByClientId = new Map<number, string>();
  private user: CollabUser;
  // Not readonly: setLlmCallbacks() merges the LLM-network handlers in after
  // construction (they're owned by useLlmNet, not whoever built the session).
  private callbacks: CollabCallbacks;
  private readonly nodeAccess: MistNodeAccess;

  constructor(user: CollabUser, callbacks: CollabCallbacks = {}, nodeAccess: MistNodeAccess = defaultNodeAccess) {
    this.user = user;
    this.nodeAccess = nodeAccess;
    this.callbacks = callbacks;
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("change", this.handleAwarenessChange);
  }

  get status_(): CollabStatus {
    return this.status;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  get localClientId(): number {
    return this.doc.clientID;
  }

  /** Runs `fn` as a local edit, so its resulting update gets broadcast to peers. */
  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL_ORIGIN);
  }

  /**
   * Attaches (or replaces) the LLM-network handlers on this session. Passing
   * a subset merges over what's there; pass `{}` to detach. Kept separate
   * from the constructor callbacks because the LLM orchestration binds to
   * whichever session is currently active, independently of who created it.
   */
  setLlmCallbacks(
    handlers: Pick<CollabCallbacks, "onLlmMessage" | "onLlmPeerConnected" | "onLlmPeerDisconnected">,
  ): void {
    this.callbacks = {
      ...this.callbacks,
      onLlmMessage: handlers.onLlmMessage,
      onLlmPeerConnected: handlers.onLlmPeerConnected,
      onLlmPeerDisconnected: handlers.onLlmPeerDisconnected,
    };
  }

  /**
   * Sends an LLM protocol message over the room, to a single peer (`toId`) or
   * broadcast (`toId === null`). Framed with the MSG_LLM prefix then the
   * mistai-encoded JSON bytes nested as a length-delimited array, decoded
   * symmetrically in handleRawMessage. No-op if the room isn't joined yet.
   */
  sendLlm(toId: string | null, msg: ProtocolMessage): void {
    if (!this.node) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_LLM);
    encoding.writeVarUint8Array(encoder, encodeLlm(msg));
    this.node.sendMessage(toId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
  }

  setLocalActiveBlock(index: number | null): void {
    const state = (this.awareness.getLocalState() as AwarenessState | null) ?? {
      peerId: this.nodeId ?? "",
      name: this.user.name,
      color: this.user.color,
      activeBlock: null,
    };
    this.awareness.setLocalState({ ...state, activeBlock: index });
  }

  /** Updates the local user's display name/color, live — peers see it on their next awareness sync. */
  setUser(user: CollabUser): void {
    this.user = user;
    const state = this.awareness.getLocalState() as AwarenessState | null;
    if (state) {
      this.awareness.setLocalState({ ...state, name: user.name, color: user.color });
    }
  }

  private setStatus(status: CollabStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    this.callbacks.onDocChange?.();
    if (origin === LOCAL_ORIGIN) this.broadcastUpdate(update);
  };

  private handleAwarenessChange = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    this.emitPeers();
    // Only broadcast changes we originated locally; changes applied while
    // decoding a remote awareness message must not be echoed back out.
    if (origin !== REMOTE_ORIGIN) {
      const changed = [...added, ...updated, ...removed];
      this.broadcastAwareness(changed);
    }
  };

  private emitPeers(): void {
    const peers: PeerInfo[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID) return;
      const s = state as Partial<AwarenessState>;
      peers.push({
        clientId,
        name: clampUserName(s.name ?? "Anonymous"),
        color: normalizeColor(s.color ?? FALLBACK_COLOR),
        activeBlock: s.activeBlock ?? null,
      });
      if (s.peerId) this.peerIdByClientId.set(clientId, s.peerId);
    });
    this.callbacks.onPeersChange?.(peers);
  }

  private broadcastUpdate(update: Uint8Array): void {
    if (!this.node) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.node.sendMessage(null, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
  }

  private broadcastAwareness(clientIds: number[]): void {
    if (!this.node || clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.node.sendMessage(null, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
  }

  private sendSyncStep1(toId: string): void {
    if (!this.node) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.node.sendMessage(toId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
  }

  private sendFullAwareness(toId: string): void {
    if (!this.node) return;
    const clientIds = Array.from(this.awareness.getStates().keys());
    if (clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.node.sendMessage(toId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
  }

  private handleRawMessage(fromId: string, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(peelLegacyEnvelope(payload) ?? payload);
    const msgType = decoding.readVarUint(decoder);

    if (msgType === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      // Tag as REMOTE_ORIGIN, not LOCAL_ORIGIN — this applies an update that
      // arrived from a peer, and handleDocUpdate must not rebroadcast it
      // (rebroadcasting an already-broadcast update is what caused the
      // unbounded echo loop with 3+ peers).
      const replyType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_ORIGIN);
      // readSyncMessage only writes a reply for step1 (responding with step2);
      // step2/update messages produce no reply, so skip sending an empty frame.
      if (replyType === syncProtocol.messageYjsSyncStep1) {
        console.debug("[collab] handleRawMessage: received sync step1, sending step2", { fromId, roomId: this.roomId });
        this.node?.sendMessage(fromId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE);
      } else {
        console.debug("[collab] handleRawMessage: received sync step2/update", { fromId, roomId: this.roomId });
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, REMOTE_ORIGIN);
    } else if (msgType === MSG_LLM) {
      // Peer-supplied bytes — decodeLlm validates every field and returns
      // null for anything malformed, so nothing untrusted reaches the
      // handler (see @tik-choco/mistai's decode()).
      const bytes = decoding.readVarUint8Array(decoder);
      const msg = decodeLlm(bytes);
      if (msg) this.callbacks.onLlmMessage?.(fromId, msg);
    }
  }

  private handlePeerDisconnected(peerId: string): void {
    console.debug("[collab] peer disconnected", { peerId, roomId: this.roomId });
    const staleClientIds = Array.from(this.peerIdByClientId.entries())
      .filter(([, pid]) => pid === peerId)
      .map(([clientId]) => clientId);
    if (staleClientIds.length === 0) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, staleClientIds, REMOTE_ORIGIN);
    staleClientIds.forEach((id) => this.peerIdByClientId.delete(id));
  }

  async join(roomId: string): Promise<void> {
    console.debug("[collab] join: connecting", { roomId });
    this.setStatus("connecting");
    try {
      // The page has exactly one MistNode, shared with note storage (see
      // mistNode.ts) — this session adopts it rather than creating its own,
      // so a room join never races storage's use of the same underlying
      // engine for the "one active MistNode per page" slot.
      const node = await this.nodeAccess.ensure();
      const nodeId = this.nodeAccess.currentId();
      if (this.disposed) {
        // The session was torn down (user left, or joined elsewhere) while
        // the node access was in flight. The node is shared with storage
        // and other sessions, so — unlike when this session owned a
        // dedicated node — leave it running rather than tearing it down.
        return;
      }
      this.node = node;
      this.nodeId = nodeId;
      this.roomId = roomId;

      const handleEvent: NodeEventHandler = (eventType, fromId, payload) => {
        // Guard against a callback firing after this session moved on
        // (destroyed, or joined a different room/node) in case mistlib
        // doesn't fully detach the event slot on leaveRoom().
        if (this.disposed || this.node !== node) return;
        if (eventType === EVENT_RAW) {
          const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
          this.handleRawMessage(fromId, bytes);
        } else if (eventType === EVENT_PEER_CONNECTED) {
          console.debug("[collab] peer connected, sending sync step1 + awareness", { fromId, roomId: this.roomId });
          this.sendSyncStep1(fromId);
          this.sendFullAwareness(fromId);
          // Let the LLM provider greet the newcomer (provider_hello).
          this.callbacks.onLlmPeerConnected?.(fromId);
        } else if (eventType === EVENT_PEER_DISCONNECTED) {
          this.handlePeerDisconnected(fromId);
          // Let the LLM consumer forget a provider that just left.
          this.callbacks.onLlmPeerDisconnected?.(fromId);
        }
      };
      // Production nodeAccess registers through mistNode.ts's shared
      // room-keyed dispatcher (the node may also be serving a dedicated LLM
      // Network room at the same time — see llmNetworkRoom.ts); test doubles
      // that don't provide onRoomEvent get the old direct-claim behavior,
      // which is fine since each simulates its own independent node.
      if (this.nodeAccess.onRoomEvent) {
        this.unregisterRoomEvent = this.nodeAccess.onRoomEvent(roomId, handleEvent);
      } else {
        node.onEvent(handleEvent);
      }

      this.awareness.setLocalState({
        peerId: nodeId,
        name: this.user.name,
        color: this.user.color,
        activeBlock: null,
      } satisfies AwarenessState);

      node.joinRoom(roomId);
      this.setStatus("connected");
      console.debug("[collab] join: connected", { roomId });
    } catch (err) {
      console.debug("[collab] join: failed", { roomId, err });
      this.setStatus("error");
      throw err;
    }
  }

  leave(): void {
    if (this.node) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [this.doc.clientID],
        LOCAL_ORIGIN,
      );
      this.unregisterRoomEvent?.();
      this.unregisterRoomEvent = null;
      this.node.leaveRoom();
      this.node = null;
    }
    this.nodeId = null;
    this.roomId = null;
    this.peerIdByClientId.clear();
    this.setStatus("idle");
  }

  destroy(): void {
    this.leave();
    this.disposed = true;
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("change", this.handleAwarenessChange);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
