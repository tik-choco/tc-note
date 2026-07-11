// Orchestrates the LLM network over a single transport (in tc-note that
// transport is the shared collab room — see collab.ts's sendLlm / MSG_LLM).
// Wires the pure ConsumerService + ProviderService to that transport and owns
// the peer-facing lifecycle: provider discovery on the consumer side, and
// provider_hello announcement + request serving on the provider side.
//
// Framework-agnostic on purpose: it takes an injected transport and an
// injected upstream-call function, so it can be unit-tested and reused
// independently of Preact. useLlmNet.ts binds an instance of this to the
// active CollabSession.

import {
  ConsumerService,
  MistaiError,
  ProviderService,
  type LlmCallFn,
  type ProviderLogEntry,
  type ChatMessage,
  type ProtocolMessage,
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
}

export interface ConsumerPeerInfo {
  nodeId: string;
  connectedAt: number;
}

const DEFAULT_PROVIDER_WAIT_MS = 10_000;

export class LlmNet {
  private readonly transport: LlmNetTransport;
  private readonly consumer: ConsumerService;
  private readonly provider: ProviderService;
  private readonly onProvidersChange?: (count: number) => void;
  private readonly onConsumersChange?: (count: number) => void;
  private readonly providerWaitTimeoutMs: number;

  // Provider-mode upstream call. Null means "not serving as a provider": we
  // neither announce provider_hello nor answer llm_request. Swapped in/out as
  // the user's settings change (see useLlmNet).
  private callLlm: LlmCallFn | null = null;

  // Peers that have announced themselves as providers (sent provider_hello).
  private readonly providers = new Set<string>();
  // Peers known to be consumers (sent consumer_hello or an llm_request),
  // keyed to when we first saw them. Surfaced in the provider-mode UI.
  private readonly consumers = new Map<string, number>();
  // requestChat callers parked until the first provider_hello arrives.
  private readonly providerWaiters: Array<(providerId: string) => void> = [];

  constructor(options: LlmNetOptions) {
    this.transport = options.transport;
    this.onProvidersChange = options.onProvidersChange;
    this.onConsumersChange = options.onConsumersChange;
    this.providerWaitTimeoutMs = options.providerWaitTimeoutMs ?? DEFAULT_PROVIDER_WAIT_MS;

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
    return this.providers.size;
  }

  /** The provider requestChat would use right now (first discovered), or null. */
  get firstProviderId(): string | null {
    return (this.providers.values().next().value as string | undefined) ?? null;
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

  /** Broadcasts provider_hello to everyone currently in the room. */
  announceProvider(): void {
    if (this.callLlm) this.transport.sendLlm(null, { v: 1, type: "provider_hello" });
  }

  /** A peer just connected: if we're a provider, greet them so they discover us. */
  handlePeerConnected(peerId: string): void {
    if (this.callLlm) this.transport.sendLlm(peerId, { v: 1, type: "provider_hello" });
  }

  /** A peer left: drop it from the discovered-providers set and fail its in-flight requests. */
  handlePeerDisconnected(peerId: string): void {
    if (this.providers.delete(peerId)) {
      this.onProvidersChange?.(this.providers.size);
      // Any request we had in flight to this provider will never complete now.
      this.consumer.rejectAll(
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
      if (!this.providers.has(fromId)) {
        this.providers.add(fromId);
        this.onProvidersChange?.(this.providers.size);
        // Wake any requestChat calls parked waiting for the first provider.
        this.providerWaiters.splice(0).forEach((waiter) => waiter(fromId));
      }
      return;
    }
    if (msg.type === "consumer_hello") {
      this.markConsumer(fromId);
      // A consumer is looking for providers — answer if we serve.
      if (this.callLlm) this.transport.sendLlm(fromId, { v: 1, type: "provider_hello" });
      return;
    }
    if (msg.type === "llm_request") {
      // A request proves the sender is a consumer even if its hello was missed.
      this.markConsumer(fromId);
      // Only serve if provider mode is on; otherwise silently ignore so a
      // pure consumer never accidentally proxies traffic.
      if (this.callLlm) void this.provider.handleMessage(fromId, msg);
      return;
    }
    // llm_response_chunk / _done / _error → correlate back to our request.
    this.consumer.handleMessage(msg);
  }

  /**
   * Sends a chat request to a discovered provider and resolves with the full
   * reply. Waits up to providerWaitTimeoutMs for a provider to appear if none
   * is known yet; rejects if the wait times out.
   *
   * Simple failover: if the first provider's request errors out and another
   * provider is already known, retries once against that other provider
   * before giving up. This only helps when a second provider was discovered
   * *before* the retry (no extra wait is spent looking for one) — good
   * enough for "someone else in the room happens to also be serving", not a
   * substitute for real retry/backoff policy. It re-sends the whole request
   * rather than resuming a partial stream, so if the first provider had
   * already emitted some deltas via `onDelta` before erroring, the retry
   * effectively restarts the reply from empty — an accepted rough edge for a
   * "simple" failover rather than a fully seamless one.
   */
  async requestChat(
    messages: ChatMessage[],
    model: string | undefined,
    onDelta?: (delta: string, full: string) => void,
  ): Promise<string> {
    const providerId = await this.waitForProvider();
    try {
      return await this.consumer.request(providerId, messages, { model, onDelta });
    } catch (err) {
      const fallbackId = this.nextProviderAfter(providerId);
      if (!fallbackId) throw err;
      return this.consumer.request(fallbackId, messages, { model, onDelta });
    }
  }

  /** The next discovered provider that isn't `excludeId`, or null if there's no other one. */
  private nextProviderAfter(excludeId: string): string | null {
    for (const id of this.providers) {
      if (id !== excludeId) return id;
    }
    return null;
  }

  private waitForProvider(): Promise<string> {
    const existing = this.providers.values().next().value as string | undefined;
    if (existing) return Promise.resolve(existing);

    // Announce ourselves as a consumer so any silent provider greets us,
    // rather than only discovering providers that happen to (re)announce.
    this.transport.sendLlm(null, { v: 1, type: "consumer_hello" });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.providerWaiters.indexOf(waiter);
        if (index >= 0) this.providerWaiters.splice(index, 1);
        reject(new MistaiError("PROVIDER_NOT_FOUND", "No provider found on the LLM Network."));
      }, this.providerWaitTimeoutMs);

      const waiter = (providerId: string): void => {
        clearTimeout(timer);
        resolve(providerId);
      };
      this.providerWaiters.push(waiter);
    });
  }
}
