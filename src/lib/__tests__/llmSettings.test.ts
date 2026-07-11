import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_LLM_SETTINGS,
  fetchModels,
  loadLlmSettings,
  saveLlmSettings,
  setConnection,
  setEmbeddingModel,
  setProviderModeEnabled,
  type LlmSettings,
} from "../llmSettings";
import { LLM_CONFIG_KEY, loadLlmConfig } from "../llmConfig";

const SETTINGS_KEY = "tc-note:llm-settings";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version for
// llmSettings.ts's raw localStorage.getItem/setItem calls to hit.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
});

describe("loadLlmSettings / saveLlmSettings", () => {
  it("returns defaults when nothing stored", () => {
    expect(loadLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("round-trips through localStorage", () => {
    const settings: LlmSettings = {
      embeddingModel: "text-embedding-3-small",
      connection: "network",
      providerModeEnabled: true,
    };
    saveLlmSettings(settings);
    expect(loadLlmSettings()).toEqual(settings);
  });

  it("fills defaults for connection/providerModeEnabled when absent", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ embeddingModel: null }));
    const loaded = loadLlmSettings();
    expect(loaded.connection).toBe("api");
    expect(loaded.providerModeEnabled).toBe(false);
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(SETTINGS_KEY, "{not json");
    expect(loadLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("falls back to defaults on malformed shape", () => {
    localStorage.setItem(SETTINGS_KEY, "null");
    expect(loadLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });
});

describe("setConnection / setProviderModeEnabled / setEmbeddingModel immutability", () => {
  it("setConnection returns a new object without mutating the original", () => {
    const next = setConnection(DEFAULT_LLM_SETTINGS, "network");
    expect(DEFAULT_LLM_SETTINGS.connection).toBe("api");
    expect(next.connection).toBe("network");
    expect(next).not.toBe(DEFAULT_LLM_SETTINGS);
  });

  it("setProviderModeEnabled returns a new object without mutating the original", () => {
    const next = setProviderModeEnabled(DEFAULT_LLM_SETTINGS, true);
    expect(DEFAULT_LLM_SETTINGS.providerModeEnabled).toBe(false);
    expect(next.providerModeEnabled).toBe(true);
  });

  it("setEmbeddingModel returns a new object without mutating the original", () => {
    const next = setEmbeddingModel(DEFAULT_LLM_SETTINGS, "text-embedding-3-small");
    expect(DEFAULT_LLM_SETTINGS.embeddingModel).toBeNull();
    expect(next.embeddingModel).toBe("text-embedding-3-small");
  });
});

describe("legacy migration", () => {
  it("merges legacy providers/llmModel/networkRoomId into the shared config and prunes them locally", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        providers: [{ id: "p1", label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" }],
        activeProviderId: "p1",
        llmModel: "gpt-4o",
        embeddingModel: "text-embedding-3-small",
        connection: "network",
        providerModeEnabled: true,
        networkRoomId: "my-ai-room",
      }),
    );

    const settings = loadLlmSettings();

    // Local record is pruned to the new shape.
    expect(settings).toEqual({
      embeddingModel: "text-embedding-3-small",
      connection: "network",
      providerModeEnabled: true,
    });
    const rawLocal = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(rawLocal.providers).toBeUndefined();
    expect(rawLocal.activeProviderId).toBeUndefined();
    expect(rawLocal.llmModel).toBeUndefined();
    expect(rawLocal.networkRoomId).toBeUndefined();

    // Shared config picked up the provider, a preset for the active model,
    // the default preset, and the network room id.
    const shared = loadLlmConfig()!;
    expect(shared.providers).toHaveLength(1);
    expect(shared.providers[0]).toMatchObject({ label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" });
    expect(shared.presets).toHaveLength(1);
    expect(shared.presets[0]).toMatchObject({ label: "gpt-4o", model: "gpt-4o", providerId: shared.providers[0].id });
    expect(shared.defaultPresetId).toBe(shared.presets[0].id);
    expect(shared.network.roomId).toBe("my-ai-room");
  });

  it("is idempotent: a second load does not duplicate providers/presets or re-run migration", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        providers: [{ id: "p1", label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" }],
        activeProviderId: "p1",
        llmModel: "gpt-4o",
        embeddingModel: null,
        connection: "api",
        providerModeEnabled: false,
        networkRoomId: null,
      }),
    );

    loadLlmSettings();
    const afterFirst = loadLlmConfig()!;
    expect(afterFirst.providers).toHaveLength(1);
    expect(afterFirst.presets).toHaveLength(1);

    loadLlmSettings();
    const afterSecond = loadLlmConfig()!;
    expect(afterSecond.providers).toHaveLength(1);
    expect(afterSecond.presets).toHaveLength(1);
  });

  it("does not overwrite an already-set defaultPresetId or network.roomId from another app", () => {
    localStorage.setItem(
      LLM_CONFIG_KEY,
      JSON.stringify({
        v: 1,
        providers: [{ id: "shared-p1", label: "Existing", baseUrl: "https://existing.example.com", apiKey: "k" }],
        presets: [{ id: "shared-preset", label: "Existing model", providerId: "shared-p1", model: "existing-model" }],
        defaultPresetId: "shared-preset",
        network: { roomId: "already-set-room" },
        updatedAt: new Date(0).toISOString(),
      }),
    );
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        providers: [{ id: "p1", label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" }],
        activeProviderId: "p1",
        llmModel: "gpt-4o",
        embeddingModel: null,
        connection: "api",
        providerModeEnabled: false,
        networkRoomId: "my-ai-room",
      }),
    );

    loadLlmSettings();
    const shared = loadLlmConfig()!;
    expect(shared.defaultPresetId).toBe("shared-preset");
    expect(shared.network.roomId).toBe("already-set-room");
    // The legacy provider/preset are still merged in (merge-never-delete),
    // just not made the default.
    expect(shared.providers.some((p) => p.baseUrl === "https://api.openai.com/v1")).toBe(true);
    expect(shared.presets.some((p) => p.model === "gpt-4o")).toBe(true);
  });

  it("does nothing when there are no legacy fields (new-shape record)", () => {
    const settings: LlmSettings = { embeddingModel: null, connection: "api", providerModeEnabled: false };
    saveLlmSettings(settings);
    loadLlmSettings();
    expect(localStorage.getItem(LLM_CONFIG_KEY)).toBeNull();
  });
});

describe("fetchModels", () => {
  const target = { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" };

  it("returns sorted model ids on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-3.5-turbo" }] }),
      }),
    );
    const ids = await fetchModels(target);
    expect(ids).toEqual(["gpt-3.5-turbo", "gpt-4o"]);
    vi.unstubAllGlobals();
  });

  // Failures are MistaiError instances from @tik-choco/mistai — the UI maps
  // their `code` through the shared catalog (formatMistaiError).

  it("throws UPSTREAM_HTTP_ERROR carrying the status on HTTP failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" }),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({
      name: "MistaiError",
      code: "UPSTREAM_HTTP_ERROR",
      details: { status: 503 },
    });
    vi.unstubAllGlobals();
  });

  it("throws UPSTREAM_HTTP_ERROR on 401 as well", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" }),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({
      code: "UPSTREAM_HTTP_ERROR",
      details: { status: 401 },
    });
    vi.unstubAllGlobals();
  });

  it("throws UPSTREAM_BAD_RESPONSE on malformed response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: true }) }),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({ code: "UPSTREAM_BAD_RESPONSE" });
    vi.unstubAllGlobals();
  });

  it("throws UPSTREAM_BAD_RESPONSE when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("not json");
        },
      }),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({ code: "UPSTREAM_BAD_RESPONSE" });
    vi.unstubAllGlobals();
  });

  it("throws MODEL_LIST_EMPTY when the list has no usable ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) }),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({ code: "MODEL_LIST_EMPTY" });
    vi.unstubAllGlobals();
  });

  it("throws UPSTREAM_REQUEST_FAILED on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(fetchModels(target)).rejects.toMatchObject({ code: "UPSTREAM_REQUEST_FAILED" });
    vi.unstubAllGlobals();
  });
});
