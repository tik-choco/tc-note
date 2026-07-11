import { describe, expect, it } from "vitest";
import { pickNetworkTransport } from "../useLlmNet";

// The room-lifecycle decision useLlmNet's effects act on: which room (if any)
// backs the "network" transport right now. The hook itself can't be rendered
// under this project's DOM-less test setup, so the contract is pinned down
// here on the pure helper — see useLlmNet.ts's module doc for the full
// rationale (collab always wins when active; the dedicated room only
// activates for "network" + a syntactically valid room id).
describe("pickNetworkTransport", () => {
  it("prefers the collab room whenever a session is active, regardless of connection or a configured dedicated room", () => {
    expect(pickNetworkTransport({ hasSession: true, connection: "api", networkRoomId: null })).toBe("collab");
    expect(pickNetworkTransport({ hasSession: true, connection: "network", networkRoomId: "my-room" })).toBe(
      "collab",
    );
  });

  it("uses the dedicated room when there's no session, connection is network, and the room id is valid", () => {
    expect(pickNetworkTransport({ hasSession: false, connection: "network", networkRoomId: "my-room" })).toBe(
      "dedicated",
    );
  });

  it("is null when there's no session and connection is api, even if a room id is configured", () => {
    expect(pickNetworkTransport({ hasSession: false, connection: "api", networkRoomId: "my-room" })).toBeNull();
  });

  it("is null when there's no session, connection is network, but no room id is set", () => {
    expect(pickNetworkTransport({ hasSession: false, connection: "network", networkRoomId: null })).toBeNull();
    expect(pickNetworkTransport({ hasSession: false, connection: "network", networkRoomId: "" })).toBeNull();
  });

  it("is null when the configured room id is syntactically invalid", () => {
    expect(
      pickNetworkTransport({ hasSession: false, connection: "network", networkRoomId: "has spaces" }),
    ).toBeNull();
    expect(
      pickNetworkTransport({ hasSession: false, connection: "network", networkRoomId: "" }),
    ).toBeNull();
  });
});
