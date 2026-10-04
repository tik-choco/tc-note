import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_LLM_SETTINGS, fetchModels, loadLlmSettings, saveLlmSettings } from "../llmSettings";
import { emptyLlmConfig, loadLlmConfig, saveLlmConfig } from "@tik-choco/mistai/llm-config";
const SETTINGS_KEY = "tc-note:llm-settings";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
function legacyConfig() {
  const config = emptyLlmConfig();
  config.providers = [
    { id: "http", label: "Endpoint", baseUrl: "https://endpoint.test/v1", apiKey: "", models: Array.from({ length: 300 }, (_, n) => "model-" + n) },
    { id: "disabled", label: "Disabled", baseUrl: "https://disabled.test/v1", apiKey: "", enabled: false },
    { id: "mirror", label: "Room", baseUrl: "mist-network://legacy-room", apiKey: "" },
  ];
  config.presets = [
    { id: "old", label: "Old", providerId: "http", model: "model-42", reasoningEffort: "high", temperature: 0.6 },
    { id: "off", label: "Off", providerId: "disabled", model: "model-off" },
    { id: "room-old", label: "Mirror", providerId: "mirror", model: "remote" },
  ];
  config.defaultPresetId = "old"; config.network.roomId = "legacy-room";
  saveLlmConfig(config); return config;
}
describe("model-ref settings migration", () => {
  it("uses defaults and round-trips v2 settings", () => {
    expect(loadLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
    const next = { ...DEFAULT_LLM_SETTINGS, tasks: { default: { ref: { providerId: "p", model: "chosen" }, reasoningEffort: "max" as const } } };
    saveLlmSettings(next); expect(loadLlmSettings().tasks.default).toEqual(next.tasks.default);
  });
  it("migrates task IDs and per-room sharing once, preserving effort and all shared legacy fields", () => {
    const old = legacyConfig();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tasks: { default: { presetId: "old", reasoningEffort: "low" }, embedding: { presetId: "off" } }, sharedPresetIds: ["old", "room-old"], networkProviderEnabled: true }));
    const first = loadLlmSettings();
    expect(first.tasks.default).toEqual({ ref: { providerId: "http", model: "model-42" }, reasoningEffort: "low" });
    expect(first.tasks.embedding.ref).toEqual({ providerId: "disabled", model: "model-off" });
    expect(first.roomProvide.mirror).toEqual({ enabled: true, shared: [{ providerId: "http", model: "model-42" }] });
    const shared = loadLlmConfig()!;
    expect(shared.defaultModel).toEqual({ providerId: "http", model: "model-42" });
    expect(shared.presets).toEqual(old.presets); expect(shared.network).toEqual(old.network); expect(shared.defaultPresetId).toEqual(old.defaultPresetId);
    expect(shared.providers[0].models).toHaveLength(300);
    const localRaw = localStorage.getItem(SETTINGS_KEY), sharedRaw = localStorage.getItem("tc-shared-llm-config-v1");
    expect(loadLlmSettings()).toEqual(first);
    expect(localStorage.getItem(SETTINGS_KEY)).toEqual(localRaw); expect(localStorage.getItem("tc-shared-llm-config-v1")).toEqual(sharedRaw);
  });
  it("inherits legacy effort but keeps an unassigned task following the default", () => {
    legacyConfig(); expect(loadLlmSettings().tasks.default).toEqual({ reasoningEffort: "high" });
  });
  it("does not resurrect a cleared ref or repeat migration after a preset changes", () => {
    legacyConfig(); localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tasks: { default: "old" } }));
    const migrated = loadLlmSettings(); delete migrated.tasks.default.ref; saveLlmSettings(migrated);
    const shared = loadLlmConfig()!; shared.presets[0].model = "changed"; saveLlmConfig(shared);
    expect(loadLlmSettings().tasks.default.ref).toBeUndefined();
  });
  it("imports older local endpoints directly to refs without writing presets or network legacy fields", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ providers: [{ id: "p", label: "Endpoint", baseUrl: "https://old.test/v1/", apiKey: "" }], activeProviderId: "p", llmModel: "model-old", networkRoomId: "old-room", providerModeEnabled: true }));
    const settings = loadLlmSettings(), config = loadLlmConfig()!;
    expect(settings.tasks.default.ref).toEqual(config.defaultModel);
    expect(config.presets).toEqual([]); expect(config.network.roomId).toBe(""); expect(config.providers).toHaveLength(2);
    expect(Object.values(settings.roomProvide)[0].enabled).toBe(true);
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
