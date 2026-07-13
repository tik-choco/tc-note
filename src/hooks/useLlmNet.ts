import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CollabSession } from "../lib/collab";
import { isValidRoomId } from "../lib/collab";
import { LlmNet, type ConsumerPeerInfo, type KnownProviderInfo, type LlmNetTransport } from "../lib/llmNet";
import { LlmNetworkRoom, type LlmNetworkRoomStatus } from "../lib/llmNetworkRoom";
import { requestApiChatCompletionStreaming } from "../lib/llm";
import { MistaiError, type ChatMessage, type ConsumerStatus, type ProviderLogEntry } from "@tik-choco/mistai";
import type { LlmConnection } from "../lib/llmSettings";
import type { ResolvedLlmTargetV1 } from "../lib/llmConfig";

export interface UseLlmNetParams {
  /** The active collab session, or null when not in a room. From useCollab. */
  session: CollabSession | null;
  /** The active room id, or null. Used to gate the "network" transport. */
  roomId: string | null;
  /** App-local transport choice (lib/llmSettings.ts). */
  connection: LlmConnection;
  /** App-local: whether to serve room peers' llm_request traffic. */
  providerModeEnabled: boolean;
  /** Shared config's AI Network room id (network.roomId), trimmed; null when unset. */
  networkRoomId: string | null;
  /** The shared config's resolved default preset (resolvePreset(shared)), or null if unresolvable. */
  resolved: ResolvedLlmTargetV1 | null;
}

/** Which room is currently backing (or being attempted for) the "network" transport. */
export type NetworkTransportKind = "collab" | "dedicated" | null;

/**
 * Pure decision of which room backs the "network" transport right now — a
 * collab session always wins when one is active (piggyback, unchanged
 * behavior); otherwise a configured, syntactically valid networkRoomId is
 * used, but only while the user has actually selected "network" as their
 * connection (the dedicated room is a network-only feature — it doesn't
 * activate just because a room id happens to be saved while "api" is
 * selected). Exported and kept dependency-free (no hooks) so it's directly
 * unit-testable without rendering the hook.
 */
export function pickNetworkTransport(params: {
  hasSession: boolean;
  connection: LlmConnection;
  networkRoomId: string | null;
}): NetworkTransportKind {
  if (params.hasSession) return "collab";
  if (params.connection === "network" && params.networkRoomId && isValidRoomId(params.networkRoomId)) {
    return "dedicated";
  }
  return null;
}

export interface UseLlmNetResult {
  /**
   * Sends a chat completion using the configured transport ("api" direct, or
   * "network" over the collab room / dedicated AI Network room). resolves
   * with the full reply. `onDelta` receives (delta, full) as tokens stream in.
   */
  send: (
    messages: ChatMessage[],
    onDelta?: (delta: string, full: string) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** The active transport, straight from settings. */
  connection: LlmConnection;
  /** Whether "api" chat can run: the shared config's default preset resolves to a provider with a base URL. */
  apiReady: boolean;
  /**
   * Whether "network" chat can run right now — either piggybacking on an
   * active collab room, or connected to the dedicated AI Network room from
   * settings (see networkSource).
   */
  networkAvailable: boolean;
  /** Which room is backing (or being attempted for) the network transport. Null when neither is in play. */
  networkSource: NetworkTransportKind;
  /** Lifecycle status of the dedicated AI Network room connection attempt. "idle" when it's not in use (collab is active, connection isn't "network", or no room id is set). */
  dedicatedRoomStatus: LlmNetworkRoomStatus;
  /** Whether we're currently serving as a provider (mode on + provider configured). */
  providerModeActive: boolean;
  /** Number of providers discovered on the room (consumer side). */
  providerCount: number;
  /** The provider a request would go to right now (first discovered), or null. */
  firstProviderId: string | null;
  /**
   * The consumer lifecycle mapped onto the shared UI's status shape: no
   * network transport connected = idle, connected with no provider yet =
   * searching (a request would still wait up to the discovery timeout),
   * provider known = connected.
   */
  consumerStatus: ConsumerStatus;
  /** Peers known to be consumers of our provider mode, oldest first. */
  consumerPeers: ConsumerPeerInfo[];
  /** Provider-mode request log, newest first (capped at 50). */
  providerLogs: ProviderLogEntry[];
}

/**
 * Binds the pure LLM orchestration (llmNet.ts) to whichever room is backing
 * the "network" transport, and to the resolved shared-config preset. Owns:
 *   - constructing/tearing down an LlmNet as the active transport comes and
 *     goes, and attaching its handlers to that transport's LLM
 *     message/peer callbacks;
 *   - keeping provider mode (the upstream-call function) in sync with settings
 *     and re-announcing provider_hello when it turns on;
 *   - a `send` that picks the api-vs-network transport per settings.
 *
 * "network" has two possible rooms, chosen by pickNetworkTransport and never
 * used at the same time:
 *   - the active collab room (CollabSession.sendLlm / MSG_LLM in collab.ts) —
 *     the original behavior, kept unchanged whenever a session is active;
 *   - a dedicated AI Network room (llmNetworkRoom.ts) joined on the page's
 *     shared mistlib node when there's no collab session but the user has
 *     set a Room ID in AI Network settings.
 * mistlib's node *can* belong to both rooms at once (see mistNode.ts), but
 * this hook deliberately keeps them mutually exclusive — collab always wins
 * when active — so there is always exactly one LlmNet's worth of
 * provider/consumer state to show in the UI, rather than merging two
 * independent peer sets.
 */
export function useLlmNet(params: UseLlmNetParams): UseLlmNetResult {
  const { session, roomId, connection, providerModeEnabled, networkRoomId, resolved } = params;

  const apiReady = Boolean(resolved && resolved.baseUrl.trim());
  const providerModeActive = providerModeEnabled && apiReady;

  const trimmedNetworkRoomId = networkRoomId?.trim() || null;
  const networkSource = pickNetworkTransport({
    hasSession: Boolean(session),
    connection,
    networkRoomId: trimmedNetworkRoomId,
  });
  // Only relevant (non-null) while the dedicated room is actually the chosen
  // transport, so editing the Room ID field while collab is piggybacking
  // doesn't churn the effects below — they'd otherwise see this change and
  // rebuild/rejoin for a room that isn't even in use right now.
  const dedicatedRoomKey = networkSource === "dedicated" ? trimmedNetworkRoomId : null;

  const [providerCount, setProviderCount] = useState(0);
  const [firstProviderId, setFirstProviderId] = useState<string | null>(null);
  const [providerTable, setProviderTable] = useState<KnownProviderInfo[]>([]);
  const [consumerPeers, setConsumerPeers] = useState<ConsumerPeerInfo[]>([]);
  const [providerLogs, setProviderLogs] = useState<ProviderLogEntry[]>([]);
  const [dedicatedRoomStatus, setDedicatedRoomStatus] = useState<LlmNetworkRoomStatus>("idle");
  // Set once the dedicated room actually finishes joining (mirrors how
  // `roomId` for collab is only set after CollabSession.join() resolves, not
  // the moment the session object exists) — networkAvailable/consumerStatus
  // below key off this rather than the optimistic "we've decided to use it".
  const dedicatedRoomJoined = dedicatedRoomStatus === "joined";

  const netRef = useRef<LlmNet | null>(null);
  // Latest resolved preset (provider connection + model + temperature/
  // reasoningEffort), read inside the (stable) upstream-call closure and
  // `send` so they always act on the current shared config without
  // rebuilding LlmNet.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const dedicatedRoomRef = useRef<LlmNetworkRoom | null>(null);
  function getDedicatedRoom(): LlmNetworkRoom {
    if (!dedicatedRoomRef.current) {
      dedicatedRoomRef.current = new LlmNetworkRoom({
        onStatusChange: setDedicatedRoomStatus,
        // Routed through the ref (not a captured `net`) so this always
        // reaches whichever LlmNet is currently live, even though this
        // LlmNetworkRoom instance itself is constructed once and reused
        // across room switches / transport hand-offs.
        onLlmMessage: (fromId, msg) => netRef.current?.handleMessage(fromId, msg),
        onLlmPeerConnected: (peerId) => netRef.current?.handlePeerConnected(peerId),
        onLlmPeerDisconnected: (peerId) => netRef.current?.handlePeerDisconnected(peerId),
      });
    }
    return dedicatedRoomRef.current;
  }

  // Dedicated room lifecycle: join it whenever it's the chosen transport,
  // leave it otherwise (including when collab takes over) or when the
  // configured room id changes. Never touches collab's room.
  useEffect(() => {
    if (!dedicatedRoomKey) {
      dedicatedRoomRef.current?.leave();
      return;
    }
    const room = getDedicatedRoom();
    room.join(dedicatedRoomKey).catch(() => {
      // Status already reflects the failure via onStatusChange; nothing else
      // to do here — send() will surface a fresh error on the next attempt.
    });
    return () => {
      room.leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedicatedRoomKey]);

  // Final teardown when the hook itself unmounts (not on every dep change
  // above, which only needs leave() — see LlmNetworkRoom.destroy()'s doc).
  useEffect(() => {
    return () => dedicatedRoomRef.current?.destroy();
  }, []);

  // Build an LlmNet for whichever room is backing "network" right now, and
  // wire it to that room's LLM callbacks. Rebuilt whenever the active room's
  // identity changes (collab session swapped in a room switch, or the
  // dedicated room id changed, or the transport kind itself changed) — a
  // fresh LlmNet means fresh provider/consumer discovery state, which is
  // correct: the old room's peers are no longer reachable.
  useEffect(() => {
    const transport: LlmNetTransport | null =
      networkSource === "collab" ? session : networkSource === "dedicated" ? getDedicatedRoom() : null;
    if (!transport) {
      netRef.current = null;
      setProviderCount(0);
      setFirstProviderId(null);
      setProviderTable([]);
      setConsumerPeers([]);
      setProviderLogs([]);
      return;
    }
    setProviderLogs([]);
    const net = new LlmNet({
      transport,
      onProvidersChange: (count) => {
        setProviderCount(count);
        setFirstProviderId(net.firstProviderId);
        setProviderTable(net.providers);
      },
      onConsumersChange: () => setConsumerPeers(net.consumerPeers),
      onProviderLog: (entry) => {
        setProviderLogs((current) => {
          const withoutEntry = current.filter((logEntry) => logEntry.id !== entry.id);
          return [entry, ...withoutEntry].slice(0, 50);
        });
      },
      // The preset's model, when resolved — read fresh on every provider_hello
      // (see LlmNet's getAdvertisedModels doc) so this always reflects the
      // current shared-config selection without rebuilding LlmNet.
      getAdvertisedModels: () => {
        const model = resolvedRef.current?.model.trim();
        return model ? [model] : undefined;
      },
    });
    netRef.current = net;
    if (networkSource === "collab" && session) {
      session.setLlmCallbacks({
        onLlmMessage: (fromId, msg) => net.handleMessage(fromId, msg),
        onLlmPeerConnected: (peerId) => net.handlePeerConnected(peerId),
        onLlmPeerDisconnected: (peerId) => net.handlePeerDisconnected(peerId),
      });
    }
    // For "dedicated", getDedicatedRoom()'s callbacks (wired once, at
    // construction) already forward onLlmMessage/onLlmPeerConnected/
    // onLlmPeerDisconnected to whatever `netRef.current` currently is, so
    // there's no per-room wiring to (re)do here.
    return () => {
      if (networkSource === "collab") session?.setLlmCallbacks({});
      netRef.current = null;
      setProviderCount(0);
      setFirstProviderId(null);
      setProviderTable([]);
      setConsumerPeers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, networkSource, dedicatedRoomKey]);

  // Keep provider mode in sync. Runs after the build effect above on the same
  // commit (declared later), so netRef.current is already the fresh instance.
  useEffect(() => {
    const net = netRef.current;
    if (!net) return;
    if (providerModeActive) {
      net.setCallLlm((messages, requestedModel, onDelta) => {
        const target = resolvedRef.current;
        if (!target) {
          return Promise.reject(
            new MistaiError("ENDPOINT_NOT_CONFIGURED", "This provider has no LLM endpoint configured."),
          );
        }
        return requestApiChatCompletionStreaming(
          { ...target, model: requestedModel ?? target.model },
          messages,
          onDelta,
        );
      });
    } else {
      net.setCallLlm(null);
    }
  }, [session, networkSource, dedicatedRoomKey, providerModeActive]);

  const networkAvailable = networkSource === "collab" ? Boolean(roomId) : networkSource === "dedicated" && dedicatedRoomJoined;

  const send = useCallback(
    async (
      messages: ChatMessage[],
      onDelta?: (delta: string, full: string) => void,
      signal?: AbortSignal,
    ): Promise<string> => {
      if (connection === "network") {
        const net = netRef.current;
        if (!net || !networkAvailable) {
          throw new MistaiError("NO_ROOM_ID", "LLM Network room ID is not set.");
        }
        // Best-effort cancellation: LlmNet/the remote room has no cancel
        // message, so the provider keeps generating regardless — this just
        // stops the caller from waiting on the result once aborted.
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const chatPromise = net.requestChat(messages, resolvedRef.current?.model, onDelta);
        if (!signal) return chatPromise;
        return new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", onAbort);
          chatPromise.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
          });
        });
      }
      // Direct API transport.
      const target = resolvedRef.current;
      if (!target || !target.baseUrl.trim()) {
        throw new MistaiError("ENDPOINT_NOT_CONFIGURED", "This provider has no LLM endpoint configured.");
      }
      let full = "";
      return requestApiChatCompletionStreaming(
        target,
        messages,
        (delta) => {
          full += delta;
          onDelta?.(delta, full);
        },
        signal,
      );
    },
    [connection, networkAvailable],
  );

  return {
    send,
    connection,
    apiReady,
    networkAvailable,
    networkSource,
    dedicatedRoomStatus,
    providerModeActive,
    providerCount,
    firstProviderId,
    consumerStatus: !networkAvailable
      ? { phase: "idle" }
      : providerCount === 0
        ? { phase: "searching" }
        : { phase: "connected", providerId: firstProviderId ?? "", providers: providerTable },
    consumerPeers,
    providerLogs,
  };
}
