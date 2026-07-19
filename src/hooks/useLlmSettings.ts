import { useEffect, useState } from "preact/hooks";
import {
  loadLlmSettings,
  saveLlmSettings,
  setConnection,
  setEmbeddingModel,
  setProviderModeEnabled,
  setReasoningEffort,
  type LlmConnection,
  type LlmSettings,
  type ReasoningEffort,
} from "../lib/llmSettings";
import {
  emptyLlmConfig,
  loadLlmConfig,
  resolvePreset,
  saveLlmConfig,
  subscribeLlmConfig,
  type LlmProviderV1,
  type ModelPresetV1,
  type SharedLlmConfigV1,
} from "../lib/llmConfig";
import {
  addSharedPreset,
  addSharedProvider,
  removeSharedPreset,
  removeSharedProvider,
  setDefaultPresetId,
  setSharedNetworkRoomId,
  updateSharedPreset,
  updateSharedProvider,
} from "../lib/llmSharedConfig";

// Binds tc-note's app-local LLM settings (connection/providerModeEnabled/
// embeddingModel, see lib/llmSettings.ts) together with the shared,
// co-owned tc-shared-llm-config-v1 config (providers/presets/defaultPresetId/
// network.roomId, see lib/llmConfig.ts). loadLlmSettings() runs its one-time
// legacy migration as a side effect the first time it's called below, so the
// shared config read that follows already reflects any migrated entries.
export function useLlmSettings() {
  const [settings, setSettings] = useState<LlmSettings>(() => loadLlmSettings());
  const [shared, setShared] = useState<SharedLlmConfigV1>(() => loadLlmConfig() ?? emptyLlmConfig());

  // Cross-tab/cross-app updates: another app (or another tab of this one)
  // may add its own provider/preset or change the default at any time.
  useEffect(() => subscribeLlmConfig((next) => setShared(next ?? emptyLlmConfig())), []);

  function persistLocal(next: LlmSettings) {
    setSettings(next);
    saveLlmSettings(next);
  }

  function persistShared(next: SharedLlmConfigV1) {
    setShared(next);
    saveLlmConfig(next);
  }

  // The default task's reasoning_effort is an app-local setting (see
  // lib/llmSettings.ts), not the shared preset's own (legacy, no longer
  // edited) `reasoningEffort` field — override it here so every caller of
  // `resolved` (useLlmNet's direct-API target and provider-mode upstream)
  // sees the value the Tasks tab actually shows, and always sends an
  // explicit value ('none' included) per llm-settings-common-v1.md §4.1.
  const resolvedPreset = resolvePreset(shared);
  const resolved = resolvedPreset ? { ...resolvedPreset, reasoningEffort: settings.reasoningEffort } : null;

  return {
    settings,
    shared,
    /** The resolved default preset's connection + model info (reasoningEffort taken from the app-local task setting, not the preset), or null if unresolvable. */
    resolved,

    setEmbeddingModel: (embeddingModel: string | null) => persistLocal(setEmbeddingModel(settings, embeddingModel)),
    setConnection: (connection: LlmConnection) => persistLocal(setConnection(settings, connection)),
    setProviderModeEnabled: (enabled: boolean) => persistLocal(setProviderModeEnabled(settings, enabled)),
    setReasoningEffort: (effort: ReasoningEffort) => persistLocal(setReasoningEffort(settings, effort)),

    addProvider: (provider: LlmProviderV1) => persistShared(addSharedProvider(shared, provider)),
    updateProvider: (id: string, patch: Partial<Omit<LlmProviderV1, "id">>) =>
      persistShared(updateSharedProvider(shared, id, patch)),
    removeProvider: (id: string) => persistShared(removeSharedProvider(shared, id)),

    addPreset: (preset: ModelPresetV1) => persistShared(addSharedPreset(shared, preset)),
    updatePreset: (id: string, patch: Partial<Omit<ModelPresetV1, "id">>) =>
      persistShared(updateSharedPreset(shared, id, patch)),
    removePreset: (id: string) => persistShared(removeSharedPreset(shared, id)),
    setDefaultPresetId: (id: string) => persistShared(setDefaultPresetId(shared, id)),

    setNetworkRoomId: (roomId: string) => persistShared(setSharedNetworkRoomId(shared, roomId)),
  };
}
