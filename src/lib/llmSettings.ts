// tc-note's app-local LLM settings, persisted to localStorage. As of the
// tc-shared-llm-config-v1 migration (see ./llmConfig.ts and
// protocol/docs/data-contracts/docs/llm-config.md), the "where to connect"
// and "which model" pieces (providers/presets/default preset/AI Network room
// id) live in the shared, co-owned tc-shared-llm-config-v1 key instead — this
// file now only holds the bits that are genuinely app-local: which transport
// the chat panel uses, whether this app serves as an AI Network provider, and
// the (still-unwired) embedding model choice.

import { fetchModels as fetchMistaiModels } from "@tik-choco/mistai";
import { emptyLlmConfig, ensurePreset, ensureProvider, loadLlmConfig, saveLlmConfig } from "./llmConfig";

const SETTINGS_KEY = "tc-note:llm-settings";

/**
 * How the chat panel reaches an LLM:
 *   - "api": call the resolved shared preset's endpoint directly with its key.
 *   - "network": send the request over the current collab room to a peer that
 *     holds the key (see llmNet.ts). Requires being in a room.
 */
export type LlmConnection = "api" | "network";

// reasoning_effort value for the (only) "default" task — chat + review both
// resolve through the same shared default preset (see App.tsx), so there is
// no per-task fan-out the way tc-translate has default/vision. 'none' is a
// real API value (explicitly disables reasoning on servers that support it),
// not "omit the field" — requests always include reasoning_effort, 'none'
// included (see llm-settings-common-v1.md §3.2/§4.1).
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"];

function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  return typeof value === "string" && (REASONING_EFFORT_OPTIONS as string[]).includes(value)
    ? (value as ReasoningEffort)
    : null;
}

export interface LlmSettings {
  /** text-embedding model id. Persisted but not wired into any call site yet. */
  embeddingModel: string | null;
  /** Transport used by the chat panel. */
  connection: LlmConnection;
  /** When true (and a preset resolves), serve llm_request traffic from room
   * peers by forwarding to the resolved preset's endpoint. */
  providerModeEnabled: boolean;
  /** reasoning_effort for the default task, always sent with the request
   * (see useLlmSettings.ts's `resolved`, which overrides the resolved
   * preset's own — now unused for this purpose — `reasoningEffort` field
   * with this app-local value). */
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  embeddingModel: null,
  connection: "api",
  providerModeEnabled: false,
  reasoningEffort: "none",
};

// --- one-time migration from the pre-shared-config local shape -----------
//
// Before tc-note adopted tc-shared-llm-config-v1, this same key also held
// `providers`/`activeProviderId`/`llmModel`/`networkRoomId` directly (see git
// history for the old shape). The first time this key is loaded after
// upgrading, any such fields found here are merged into the shared config —
// via ensureProvider/ensurePreset, which only ever append and never overwrite
// another app's entries (merge-never-delete, see llm-config.md) — and then
// dropped from what's written back to this key, so the migration only runs
// once per browser profile.

const LEGACY_KEYS = ["providers", "activeProviderId", "llmModel", "networkRoomId"] as const;

interface LegacyProviderLike {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

function isLegacyProvider(value: unknown): value is LegacyProviderLike {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    typeof p.baseUrl === "string" &&
    typeof p.apiKey === "string"
  );
}

function hasLegacyKeys(record: Record<string, unknown>): boolean {
  return LEGACY_KEYS.some((key) => key in record);
}

/**
 * Merges `record`'s legacy provider/model/room fields (if any) into
 * tc-shared-llm-config-v1. Migration mapping:
 *   - each legacy `providers[]` entry -> ensureProvider (dedup by baseUrl+apiKey)
 *   - legacy `llmModel` (non-empty) + `activeProviderId` resolvable to one of
 *     the just-ensured providers -> ensurePreset({ label: llmModel, providerId, model: llmModel });
 *     becomes `defaultPresetId` only if that was still unset
 *   - legacy `networkRoomId` (non-empty) -> `network.roomId`, only if unset
 */
function migrateLegacyRecord(record: Record<string, unknown>): void {
  const legacyProviders = Array.isArray(record.providers) ? record.providers.filter(isLegacyProvider) : [];
  const legacyActiveId = typeof record.activeProviderId === "string" ? record.activeProviderId : null;
  const legacyModel = typeof record.llmModel === "string" ? record.llmModel.trim() : "";
  const legacyRoomId = typeof record.networkRoomId === "string" ? record.networkRoomId.trim() : "";

  if (legacyProviders.length === 0 && !legacyModel && !legacyRoomId) return;

  const shared = loadLlmConfig() ?? emptyLlmConfig();

  const idMap = new Map<string, string>();
  for (const p of legacyProviders) {
    idMap.set(p.id, ensureProvider(shared, { label: p.label, baseUrl: p.baseUrl, apiKey: p.apiKey }));
  }

  if (legacyModel) {
    const mappedActiveId = legacyActiveId ? idMap.get(legacyActiveId) : undefined;
    if (mappedActiveId) {
      const presetId = ensurePreset(shared, { label: legacyModel, providerId: mappedActiveId, model: legacyModel });
      if (!shared.defaultPresetId) shared.defaultPresetId = presetId;
    }
  }

  if (legacyRoomId && !shared.network.roomId) {
    shared.network.roomId = legacyRoomId;
  }

  saveLlmConfig(shared);
}

export function loadLlmSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_LLM_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_LLM_SETTINGS;
    const record = parsed as Record<string, unknown>;

    const legacy = hasLegacyKeys(record);
    if (legacy) migrateLegacyRecord(record);

    // reasoningEffort used to live only on the shared config's ModelPresetV1
    // (edited from the old AI Connection preset form) rather than as an
    // app-local per-task value. If this record predates that field, pick up
    // the current default preset's legacy value once so behavior doesn't
    // silently change for existing users — but don't touch the shared preset
    // itself (that field is a cross-app, co-owned record; leaving it in
    // place is harmless now that nothing reads it for the actual request).
    // A pristine install (no `reasoningEffort` key AND no shared config to
    // read from) just gets the plain default, which is not a "migration".
    const hasStoredReasoningEffort = typeof record.reasoningEffort === "string";
    let reasoningEffort = parseReasoningEffort(record.reasoningEffort) ?? "none";
    if (!hasStoredReasoningEffort) {
      const sharedForMigration = loadLlmConfig();
      const defaultPreset = sharedForMigration?.presets.find((p) => p.id === sharedForMigration.defaultPresetId);
      reasoningEffort = parseReasoningEffort(defaultPreset?.reasoningEffort) ?? reasoningEffort;
    }

    const settings: LlmSettings = {
      embeddingModel: typeof record.embeddingModel === "string" ? record.embeddingModel : null,
      connection: record.connection === "network" ? "network" : "api",
      providerModeEnabled: record.providerModeEnabled === true,
      reasoningEffort,
    };

    // Drop the legacy fields (if any) from what's persisted, so this record
    // is in the new shape from now on and migration doesn't re-run.
    if (legacy || !hasStoredReasoningEffort) saveLlmSettings(settings);

    return settings;
  } catch {
    return DEFAULT_LLM_SETTINGS;
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function setConnection(settings: LlmSettings, connection: LlmConnection): LlmSettings {
  return { ...settings, connection };
}

export function setProviderModeEnabled(settings: LlmSettings, providerModeEnabled: boolean): LlmSettings {
  return { ...settings, providerModeEnabled };
}

export function setEmbeddingModel(settings: LlmSettings, embeddingModel: string | null): LlmSettings {
  return { ...settings, embeddingModel };
}

export function setReasoningEffort(settings: LlmSettings, reasoningEffort: ReasoningEffort): LlmSettings {
  return { ...settings, reasoningEffort };
}

/**
 * Fetches available model ids from an OpenAI-compatible `GET /models`
 * endpoint, sorted for stable display. Delegates to @tik-choco/mistai's
 * fetchModels, which throws a MistaiError (UPSTREAM_REQUEST_FAILED /
 * UPSTREAM_HTTP_ERROR / UPSTREAM_BAD_RESPONSE / MODEL_LIST_EMPTY) on failure
 * — callers should surface it via formatMistaiError. Takes just the
 * baseUrl/apiKey pair so it works for both a shared LlmProviderV1 and the
 * onboarding wizard's own draft.
 */
export async function fetchModels(target: { baseUrl: string; apiKey: string }): Promise<string[]> {
  const ids = await fetchMistaiModels({ baseUrl: target.baseUrl, apiKey: target.apiKey });
  return [...ids].sort((a, b) => a.localeCompare(b));
}
