// Orchestrates the LLM network over a single transport (in tc-note that
// transport is the shared collab room — see collab.ts's sendLlm / MSG_LLM).
// Wires the pure ConsumerService + ProviderService to that transport and owns
// the peer-facing lifecycle: provider discovery on the consumer side, and
// provider_hello announcement + request serving on the provider side.
//
// This is mistai's documented "Pattern B" integration (see mistai's
// README.md, "apps with a custom transport (tc-note's Yjs collab room)"):
// tc-note's LLM traffic rides the same mistlib room as Yjs sync/awareness,
// multiplexed under collab.ts's 1-byte MSG_LLM prefix, and the dedicated AI
// Network room (llmNetworkRoom.ts) is joined through the page's single shared
// MistNode (mistNode.ts) rather than a node of its own. Both are incompatible
// with mistai's higher-level `ConsumerClient` / `useNetworkProvider`, which
// each open and own their *own* `Network` (mistlib node + room join) end to
// end — there is no way to hand them an already-joined, externally-multiplexed
// channel. So this module stays on the transport-injected primitives
// (`ConsumerService` / `ProviderService`, `send: SendFn`) and reimplements the
// same provider-table + service/model matching + single-retry-failover
// algorithm `ConsumerClient` uses, reusing mistai's exported pure building
// blocks (`selectProvider`, `helloServices`, `rejectLlmRequest`,
// `isFailoverEligible`) so behavior stays identical to the standard
// implementation even though the transport wiring can't be.
//
// Framework-agnostic on purpose: it takes an injected transport and an
// injected upstream-call function, so it can be unit-tested and reused
// independently of Preact. useLlmNet.ts binds an instance of this to the
// active CollabSession.

import {
  ConsumerService,
  MistaiError,
  ProviderService,
  helloServices,
  isFailoverEligible,
  rejectLlmRequest,
  selectProvider,
  type ChatMessage,
  type LlmCallFn,
  type ProtocolMessage,
  type ProviderLogEntry,
  type ProviderSelection,
} from "@tik-choco/mistai";

/** The seam onto the underlying room: CollabSession.sendLlm satisfies this. */
export interface LlmNetTransport {
  sendLlm(toId: string | null, msg: ProtocolMessage): void;
}

export interface LlmNetOptions {
  transport: LlmNetTransport;
  /** Fired whenever the set of discovered providers grows or shrinks. */
  onProvidersChange?: (count: number) => void;
  /** Fired whenever the set of known consumer peers grows or shrinks (provider-mode UI). */
  onConsumersChange?: (count: number) => void;
  /** Forwarded to the ProviderService request log (provider-mode UI). */
  onProviderLog?: (entry: ProviderLogEntry) => void;
  /** How long requestChat waits for a provider_hello before giving up. */
  providerWaitTimeoutMs?: number;
  /**
   * Per-request inactivity timeout for requestChat, mirroring mistai's
   * ConsumerClient default (120s) so chat over this transport can't hang
   * forever either. Pass 0 to disable and wait indefinitely.
   */
  requestTimeoutMs?: number;
  /**
   * Model ids this node's provider currently serves, advertised via
   * provider_hello.models when non-empty. Read fresh on every hello (a
   * function, not a static list) so the caller can back it with a ref and
   * change the resolved model without rebuilding LlmNet.
   */
  getAdvertisedModels?: () => string[] | undefined;
}

export interface ConsumerPeerInfo {
  nodeId: string;
  connectedAt: number;
}

/** What this node knows about one announced provider (mirrors mistai's internal, non-exported ProviderInfo). */
export interface KnownProviderInfo {
  id: string;
  models?: string[];
  services: readonly string[];
}

const DEFAULT_PROVIDER_WAIT_MS = 10_000;
// Matches mistai's ConsumerClient (client.ts's DEFAULT_CHAT_TIMEOUT_MS,
// not exported) so a chat request over this transport fails on the same
// timescale as one made through the dedicated-room ConsumerClient path.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

interface ProviderTableEntry {
  models?: string[];
  services: readonly string[];
}

interface ProviderWaiter {
  model: string | undefined;
  resolve: (selection: ProviderSelection) => void;
}

export class LlmNet {
  private readonly transport: LlmNetTransport;
  private readonly consumer: ConsumerService;
  private readonly provider: ProviderService;
  private readonly onProvidersChange?: (count: number) => void;
  private readonly onConsumersChange?: (count: number) => void;
  private readonly providerWaitTimeoutMs: number;
  private readonly requestTimeoutMs: number | undefined;
  private readonly getAdvertisedModels?: () => string[] | undefined;

  // Provider-mode upstream call. Null means "not serving as a provider": we
  // neither announce provider_hello nor answer llm_request (beyond a capability
  // rejection — see handleMessage). Swapped in/out as the user's settings
  // change (see useLlmNet).
  private callLlm: LlmCallFn | null = null;

  // Providers discovered on the room, keyed by peer id, with whatever
  // services/models they last announced in a provider_hello. Mirrors
  // mistai's ConsumerClient provider table.
  private readonly providerTable = new Map<string, ProviderTableEntry>();
  // Peers known to be consumers (sent consumer_hello or an llm_request),
  // keyed to when we first saw them. Surfaced in the provider-mode UI.
  private readonly consumers = new Map<string, number>();
  // requestChat callers parked until an eligible provider_hello arrives.
  private providerWaiters: ProviderWaiter[] = [];

  constructor(options: LlmNetOptions) {
    this.transport = options.transport;
    this.onProvidersChange = options.onProvidersChange;
    this.onConsumersChange = options.onConsumersChange;
    this.providerWaitTimeoutMs = options.providerWaitTimeoutMs ?? DEFAULT_PROVIDER_WAIT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs === 0 ? undefined : (options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.getAdvertisedModels = options.getAdvertisedModels;

    this.consumer = new ConsumerService((toId, msg) => this.transport.sendLlm(toId, msg));
    this.provider = new ProviderService(
      (toId, msg) => this.transport.sendLlm(toId, msg),
      // Indirect through the mutable field so the upstream call can change
      // (or be disabled) without rebuilding the ProviderService.
      (messages, model, onDelta) => {
        const fn = this.callLlm;
        if (!fn) {
          return Promise.reject(
            new MistaiError("ENDPOINT_NOT_CONFIGURED", "This provider has no LLM endpoint configured."),
          );
        }
        return fn(messages, model, onDelta);
      },
      { onRequestLog: options.onProviderLog },
    );
  }

  /** True when this node is currently serving as a provider. */
  get providerActive(): boolean {
    return this.callLlm !== null;
  }

  /** Number of providers discovered on the room (consumer side). */
  get providerCount(): number {
    return this.providerTable.size;
  }

  /** The first-discovered provider's id (backward-compatible representative id), or null. */
  get firstProviderId(): string | null {
    return (this.providerTable.keys().next().value as string | undefined) ?? null;
  }

  /** Snapshot of the known provider table, oldest first — surfaced for ConsumerStatus.providers. */
  get providers(): KnownProviderInfo[] {
    return [...this.providerTable].map(([id, info]) => ({ id, models: info.models, services: info.services }));
  }

  /** Peers known to be consumers, oldest first (provider-mode UI). */
  get consumerPeers(): ConsumerPeerInfo[] {
    return [...this.consumers].map(([nodeId, connectedAt]) => ({ nodeId, connectedAt }));
  }

  private markConsumer(peerId: string): void {
    if (!this.consumers.has(peerId)) {
      this.consumers.set(peerId, Date.now());
      this.onConsumersChange?.(this.consumers.size);
    }
  }

  /**
   * Enables or disables provider mode. Pass the upstream-call function to
   * serve requests; pass null to stop serving. Enabling immediately announces
   * provider_hello to the whole room so consumers already present discover us.
   */
  setCallLlm(fn: LlmCallFn | null): void {
    const wasActive = this.callLlm !== null;
    this.callLlm = fn;
    if (fn && !wasActive) this.announceProvider();
  }

  /** Builds the provider_hello this node currently advertises (services fixed to "chat"; models read fresh). */
  private helloMessage(): ProtocolMessage {
    const models = this.getAdvertisedModels?.();
    return {
      v: 1,
      type: "provider_hello",
      services: ["chat"],
      ...(models && models.length > 0 ? { models } : {}),
    };
  }

  /** Broadcasts provider_hello to everyone currently in the room. */
  announceProvider(): void {
    if (this.callLlm) this.transport.sendLlm(null, this.helloMessage());
  }

  /** A peer just connected: if we're a provider, greet them so they discover us. */
  handlePeerConnected(peerId: string): void {
    if (this.callLlm) this.transport.sendLlm(peerId, this.helloMessage());
  }

  /** A peer left: drop it from the discovered-providers table and fail its in-flight requests. */
  handlePeerDisconnected(peerId: string): void {
    if (this.providerTable.delete(peerId)) {
      this.onProvidersChange?.(this.providerTable.size);
      // Only the requests actually sent to this provider are rejected — an
      // in-flight request to a different, still-connected provider is left
      // alone (mistai's ConsumerService.rejectByProvider, new in v0.4).
      this.consumer.rejectByProvider(
        peerId,
        new MistaiError("PROVIDER_DISCONNECTED", "Connection to the provider was lost."),
      );
    }
    if (this.consumers.delete(peerId)) {
      this.onConsumersChange?.(this.consumers.size);
    }
  }

  /** Routes a decoded LLM message from `fromId` to the right service. */
  handleMessage(fromId: string, msg: ProtocolMessage): void {
    if (msg.type === "provider_hello") {
      this.providerTable.set(fromId, { models: msg.models, services: helloServices(msg) });
      this.onProvidersChange?.(this.providerTable.size);
      // Wake any requestChat calls parked waiting for an eligible provider.
      this.resolveProviderWaiters();
      return;
    }
    if (msg.type === "consumer_hello") {
      this.markConsumer(fromId);
      // A consumer is looking for providers — answer if we serve.
      if (this.callLlm) this.transport.sendLlm(fromId, this.helloMessage());
      return;
    }
    if (msg.type === "llm_request") {
      // A request proves the sender is a consumer even if its hello was missed.
      this.markConsumer(fromId);
      if (this.callLlm) {
        void this.provider.handleMessage(fromId, msg);
      } else {
        // Not (or no longer) serving: reject immediately with the standard
        // unsupported_service error instead of silently dropping it, so a
        // stale table entry (provider mode was turned off without leaving
        // the room) fails the requester over fast rather than eating the
        // full request timeout — matches mistai's provider-side behavior
        // (routeProviderRequest / useNetworkProvider).
        rejectLlmRequest((toId, m) => this.transport.sendLlm(toId, m), fromId, msg.id);
      }
      return;
    }
    // llm_response_chunk / _done / _error → correlate back to our request.
    this.consumer.handleMessage(msg);
  }

  /**
   * Sends a chat request to an eligible discovered provider (matching by
   * service="chat" and, when given, by advertised model — see
   * mistai's `selectProvider`) and resolves with the full reply. Waits up to
   * providerWaitTimeoutMs for one to appear if none is known yet.
   *
   * Single-retry failover: if the first attempt fails with a
   * failover-eligible error (disconnect, timeout, or unsupported_service) and
   * no output has reached the caller yet, retries once against another
   * eligible provider. Mirrors mistai's ConsumerClient.requestChat exactly,
   * reusing the same `selectProvider` matching function.
   */
  async requestChat(
    messages: ChatMessage[],
    model: string | undefined,
    onDelta?: (delta: string, full: string) => void,
  ): Promise<string> {
    const first = await this.waitForProvider(model);
    // Tracks whether any output has already reached the caller: once a
    // stream has started, failing over to another provider would produce
    // duplicate/garbled output, so failover is only attempted before the
    // first chunk arrives.
    let receivedChunk = false;
    const wrappedOnDelta = (delta: string, full: string) => {
      receivedChunk = true;
      onDelta?.(delta, full);
    };
    try {
      return await this.consumer.request(first.providerId, messages, {
        model: first.model,
        onDelta: wrappedOnDelta,
        timeoutMs: this.requestTimeoutMs,
      });
    } catch (err) {
      if (receivedChunk || !isFailoverEligible(err)) throw err;
      const retry = selectProvider(this.providerTable, "chat", model, new Set([first.providerId]));
      if (!retry) throw err;
      return this.consumer.request(retry.providerId, messages, {
        model: retry.model,
        onDelta: wrappedOnDelta,
        timeoutMs: this.requestTimeoutMs,
      });
    }
  }

  /** Resolves any pending waitForProvider() calls the updated table can now satisfy. */
  private resolveProviderWaiters(): void {
    if (this.providerWaiters.length === 0) return;
    const remaining: ProviderWaiter[] = [];
    for (const waiter of this.providerWaiters) {
      const selection = selectProvider(this.providerTable, "chat", waiter.model);
      if (selection) waiter.resolve(selection);
      else remaining.push(waiter);
    }
    this.providerWaiters = remaining;
  }

  /** Resolves immediately if an eligible provider already exists, otherwise waits for one. */
  private waitForProvider(model: string | undefined): Promise<ProviderSelection> {
    const immediate = selectProvider(this.providerTable, "chat", model);
    if (immediate) return Promise.resolve(immediate);

    // Announce ourselves as a consumer so any silent provider greets us,
    // rather than only discovering providers that happen to (re)announce.
    this.transport.sendLlm(null, { v: 1, type: "consumer_hello" });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.providerWaiters.indexOf(waiter);
        if (index >= 0) this.providerWaiters.splice(index, 1);
        reject(new MistaiError("PROVIDER_NOT_FOUND", "No provider found on the LLM Network."));
      }, this.providerWaitTimeoutMs);

      const waiter: ProviderWaiter = {
        model,
        resolve: (selection) => {
          clearTimeout(timer);
          resolve(selection);
        },
      };
      this.providerWaiters.push(waiter);
    });
  }
}
