// mistlib-wasm supports exactly one active MistNode per page — note storage
// (storage_add/storage_get) and real-time collab rooms are not independent
// subsystems, they're both facets of the same underlying P2P engine (the
// wasm side wires up its content store as part of node startup; see
// mistlib-wasm's storage.rs/wasm_l0.rs). Two independent
// `new MistNode(...).init()` calls — one for storage, one for a collab
// room — race for that single slot; whichever inits second throws
// "mistlib-wasm supports one active MistNode per page; call leaveRoom()
// before initializing another node." Both mistlib.ts (storage) and
// collab.ts (rooms) must go through this one shared instance instead.
//
// The node *can* belong to several rooms at once, though — joinRoom(roomId)
// is safe to call repeatedly with different ids, sendMessage/leaveRoom/
// getNeighbors all take an optional roomId to scope to one of them, and every
// event the wrapper delivers is tagged with the roomId it belongs to (see
// index.js's register_event_callback shim, which forwards
// `(eventType, fromId, payload, roomId)`). What the node does *not* support
// is more than one *event handler*: onEvent() replaces a single `_onEvent`
// slot, so whoever calls it last wins and silently cuts off whoever
// registered before them. Room-scoped consumers of the shared node (collab.ts
// sessions, and llmNetworkRoom.ts's dedicated AI Network room) must not call
// node.onEvent() themselves — they register here instead, keyed by roomId,
// and a single dispatcher (installed once, kept across any number of
// teardown/reinit cycles since `node` itself is never replaced) fans events
// out to the right one.
import { MistNode } from "../vendor/mistlib/wrappers/web/index.js";

export type NodeEventHandler = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId: string,
) => void;

const roomHandlers = new Map<string, NodeEventHandler>();
// Tracks which node instance currently owns the dispatcher registration, so
// installDispatcher is a no-op once it's done its one real `n.onEvent(...)`
// call — safe to invoke on every ensureMistNode() resolution regardless.
let dispatcherNode: InstanceType<typeof MistNode> | null = null;

function installDispatcher(n: InstanceType<typeof MistNode>): void {
  if (dispatcherNode === n) return;
  n.onEvent((eventType, fromId, payload, roomId) => {
    roomHandlers.get(roomId)?.(eventType, fromId, payload, roomId);
  });
  dispatcherNode = n;
}

/**
 * Registers `handler` for events belonging to `roomId` on the page's shared
 * node, without disturbing any other room's handler (see the module doc
 * above). Returns a function that unregisters it — call it once the caller
 * leaves that room, so a later join to a different room can't ever reach a
 * stale handler.
 */
export function onRoomEvent(roomId: string, handler: NodeEventHandler): () => void {
  roomHandlers.set(roomId, handler);
  return () => {
    if (roomHandlers.get(roomId) === handler) roomHandlers.delete(roomId);
  };
}

const NODE_ID_KEY = "tc-note:node-id";

function loadOrCreateNodeId(): string {
  let id = localStorage.getItem(NODE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(NODE_ID_KEY, id);
  }
  return id;
}

// Computed lazily (not at module load) so importing this module has no
// side effect on environments without `localStorage` (e.g. this module is
// imported for its types in tests that run under vitest's default node
// environment, which has no Web Storage API).
let pageNodeId: string | null = null;
function getPageNodeId(): string {
  if (!pageNodeId) pageNodeId = loadOrCreateNodeId();
  return pageNodeId;
}

let node: InstanceType<typeof MistNode> | null = null;
let initPromise: Promise<InstanceType<typeof MistNode>> | null = null;

// Resolves once the page's single MistNode is ready to use. Creates it on
// first call; re-initializes it if a previous collab session's leaveRoom()
// tore it down — mistlib-wasm's leaveRoom() fully decommissions the node
// (not just the room, see CollabSession.leave() in collab.ts), so the next
// consumer (storage or a fresh room join) needs to bring it back up.
export async function ensureMistNode(): Promise<InstanceType<typeof MistNode>> {
  // `initialized` is a real runtime property the vendor JS wrapper sets
  // (flipped back to false by leaveRoom()) but it isn't part of the
  // vendored .d.ts's public surface — hence the cast rather than a type
  // error, since that .d.ts is regenerated upstream and not ours to extend.
  if (node && (node as unknown as { initialized: boolean }).initialized) {
    installDispatcher(node);
    return node;
  }
  if (!initPromise) {
    initPromise = (async () => {
      if (!node) node = new MistNode(getPageNodeId());
      await node.init();
      installDispatcher(node);
      return node;
    })();
    initPromise.finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

// The page's single MistNode's own id — used as this participant's identity
// in collab room presence (see collab.ts's awareness `peerId`).
export function currentNodeId(): string {
  return getPageNodeId();
}
