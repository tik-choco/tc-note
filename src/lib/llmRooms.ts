import { createRoomConsumers } from "@tik-choco/mistai";
import { createSharedMistNode } from "./mistNode";

export const rooms = createRoomConsumers(createSharedMistNode, { nodeIdStorageKey: "tc-note:node-id" });
