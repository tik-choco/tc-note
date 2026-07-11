// Exercises the LlmNet orchestration (provider discovery, request routing,
// provider serving) over a fake in-memory hub that stands in for the collab
// room transport. Two LlmNet instances are wired to the hub as peers "A" and
// "B"; the hub delivers each sendLlm to the addressed peer's handleMessage.

import { describe, it, expect } from "vitest";
import { LlmNet, type LlmNetTransport } from "../llmNet";
import { MistaiError, type ProtocolMessage } from "@tik-choco/mistai";

interface Peer {
  id: string;
  net: LlmNet;
  handle: (fromId: string, msg: ProtocolMessage) => void;
}

// A synchronous two-peer hub. `deliver` mirrors mistlib's routing: toId===null
// broadcasts to every other peer; a concrete toId targets exactly that peer.
function makeHub() {
  const peers = new Map<string, Peer>();

  function deliver(fromId: string, toId: string | null, msg: ProtocolMessage) {
    for (const peer of peers.values()) {
      if (peer.id === fromId) continue;
      if (toId !== null && peer.id !== toId) continue;
      peer.handle(fromId, msg);
    }
  }

  function addPeer(id: string, build: (transport: LlmNetTransport) => LlmNet): Peer {
    const transport: LlmNetTransport = { sendLlm: (toId, msg) => deliver(id, toId, msg) };
    const net = build(transport);
    const peer: Peer = { id, net, handle: (fromId, msg) => net.handleMessage(fromId, msg) };
    peers.set(id, peer);
    return peer;
  }

  return { addPeer };
}

describe("LlmNet orchestration", () => {
  it("discovers a provider that announces on peer connect, then serves a streamed request", async () => {
    const hub = makeHub();

    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const provider = hub.addPeer("B", (transport) => new LlmNet({ transport }));

    // Provider forwards requests to a fake upstream that streams two chunks.
    provider.net.setCallLlm(async (_messages, _model, onDelta) => {
      onDelta("Hel");
      onDelta("lo");
      return "Hello";
    });

    // Simulate the room telling the provider that A just connected: it greets
    // A with provider_hello (routed through the hub to A.handleMessage).
    provider.net.handlePeerConnected("A");
    expect(consumer.net.providerCount).toBe(1);

    const deltas: string[] = [];
    const reply = await consumer.net.requestChat(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      (d) => deltas.push(d),
    );

    expect(reply).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("waits for a provider_hello before sending, when none is known yet", async () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const provider = hub.addPeer("B", (transport) => new LlmNet({ transport }));

    provider.net.setCallLlm(async (_m, _model, onDelta) => {
      onDelta("ok");
      return "ok";
    });

    // Kick off the request first; no provider is known, so it parks. The
    // consumer_hello it broadcasts reaches the provider, which answers with
    // provider_hello — unblocking the parked request.
    const promise = consumer.net.requestChat([{ role: "user", content: "hi" }], undefined);

    await expect(promise).resolves.toBe("ok");
    expect(consumer.net.providerCount).toBe(1);
  });

  it("times out with a PROVIDER_NOT_FOUND MistaiError when no provider is present", async () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport, providerWaitTimeoutMs: 20 }));
    hub.addPeer("B", (transport) => new LlmNet({ transport })); // never a provider

    const promise = consumer.net.requestChat([{ role: "user", content: "hi" }], undefined);
    await expect(promise).rejects.toBeInstanceOf(MistaiError);
    await expect(promise).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
  });

  it("rejects an in-flight request with PROVIDER_DISCONNECTED when the provider leaves", async () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const provider = hub.addPeer("B", (transport) => new LlmNet({ transport }));

    // An upstream that never resolves, so the request stays in flight.
    provider.net.setCallLlm(() => new Promise<string>(() => {}));
    provider.net.handlePeerConnected("A");

    const promise = consumer.net.requestChat([{ role: "user", content: "hi" }], undefined);
    // requestChat resolves provider discovery on a microtask before the
    // request is registered in flight — yield once so the disconnect lands
    // after registration.
    await Promise.resolve();
    consumer.net.handlePeerDisconnected("B");

    await expect(promise).rejects.toBeInstanceOf(MistaiError);
    await expect(promise).rejects.toMatchObject({ code: "PROVIDER_DISCONNECTED" });
  });

  it("fails over to a second discovered provider when the first one's request errors", async () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const flaky = hub.addPeer("B", (transport) => new LlmNet({ transport }));
    const backup = hub.addPeer("C", (transport) => new LlmNet({ transport }));

    flaky.net.setCallLlm(() => Promise.reject(new Error("upstream exploded")));
    backup.net.setCallLlm(async () => "from backup");

    flaky.net.handlePeerConnected("A");
    backup.net.handlePeerConnected("A");
    expect(consumer.net.providerCount).toBe(2);
    expect(consumer.net.firstProviderId).toBe("B"); // the flaky one is discovered first

    const reply = await consumer.net.requestChat([{ role: "user", content: "hi" }], undefined);
    expect(reply).toBe("from backup");
  });

  it("does not fail over when the first provider errors and no other provider is known", async () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const onlyProvider = hub.addPeer("B", (transport) => new LlmNet({ transport }));

    onlyProvider.net.setCallLlm(() => Promise.reject(new Error("nope")));
    onlyProvider.net.handlePeerConnected("A");

    // Errors always cross the wire as a MistaiError("REMOTE_ERROR", message) —
    // the provider only ever sends a message string, never the original
    // error's class/code (see ProviderService.handleMessage's catch).
    const promise = consumer.net.requestChat([{ role: "user", content: "hi" }], undefined);
    await expect(promise).rejects.toMatchObject({ code: "REMOTE_ERROR", message: "nope" });
  });

  it("forgets a provider when it disconnects", () => {
    const hub = makeHub();
    const consumer = hub.addPeer("A", (transport) => new LlmNet({ transport }));
    const provider = hub.addPeer("B", (transport) => new LlmNet({ transport }));

    provider.net.setCallLlm(async () => "x");
    provider.net.handlePeerConnected("A");
    expect(consumer.net.providerCount).toBe(1);

    consumer.net.handlePeerDisconnected("B");
    expect(consumer.net.providerCount).toBe(0);
  });
});
