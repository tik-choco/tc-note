import { MistNode } from "../vendor/mistlib/wrappers/web/index.js";
import { mistSignalingConfig } from "./mistSignaling";
import { createSharedNodeScope, type MistNodeLike } from "@tik-choco/mistai";

export type NodeEventHandler = (eventType: number, fromId: string, payload: unknown, roomId: string) => void;
const NODE_ID_KEY = "tc-note:node-id";
let pageNodeId: string | null = null;
let node: InstanceType<typeof MistNode> | null = null;
let initPromise: Promise<InstanceType<typeof MistNode>> | null = null;
let eventHandler: Parameters<MistNodeLike["onEvent"]>[0] | undefined;

export function currentNodeId(): string {
  if (!pageNodeId) {
    pageNodeId = localStorage.getItem(NODE_ID_KEY) || crypto.randomUUID();
    localStorage.setItem(NODE_ID_KEY, pageNodeId);
  }
  return pageNodeId;
}

// Storage and every room share the wrapper's single active node. Install its
// event slot once; mistai owns event fan-out and room reference counting.
export async function ensureMistNode(): Promise<InstanceType<typeof MistNode>> {
  if (node && (node as unknown as { initialized: boolean }).initialized) return node;
  if (!initPromise) {
    initPromise = (async () => {
      if (!node) {
        node = new MistNode(currentNodeId(), mistSignalingConfig());
        node.onEvent((type, from, payload, room) => eventHandler?.(type, from, payload, room));
      }
      await node.init();
      return node;
    })();
    void initPromise.then(() => { initPromise = null; }, () => { initPromise = null; });
  }
  return initPromise;
}

export const createSharedMistNode = createSharedNodeScope(() => ({
  init: async () => { await ensureMistNode(); },
  onEvent: handler => { eventHandler = handler; },
  joinRoom: async roomId => { const n = await ensureMistNode(); await n.joinRoomAsync(roomId); },
  joinRoomAsync: async roomId => { const n = await ensureMistNode(); await n.joinRoomAsync(roomId); },
  leaveRoom: roomId => { if (roomId) node?.leaveRoom(roomId); },
  sendMessage: (toId, payload, delivery, roomId) => { node?.sendMessage(toId, payload, delivery, roomId); },
}));
