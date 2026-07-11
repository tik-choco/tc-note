// App-local CRUD helpers for editing the *shared* LLM config
// (tc-shared-llm-config-v1, see ./llmConfig.ts) from tc-note's Settings UI.
//
// llmConfig.ts (the vendored contract module — don't edit it here) only
// exposes ensureProvider/ensurePreset: dedup find-or-create helpers meant for
// one-time migration, not for direct user-driven add/edit/delete. These
// functions fill that gap with the same immutable-update pattern tc-note used
// to have for its own (now-retired) local provider list, just retargeted at
// SharedLlmConfigV1. Each function returns a new config object; callers are
// responsible for calling saveLlmConfig() themselves (mirrors llmConfig.ts's
// own ensureProvider/ensurePreset, which also just mutate-and-return).

import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "./llmConfig";

export function addSharedProvider(config: SharedLlmConfigV1, provider: LlmProviderV1): SharedLlmConfigV1 {
  return { ...config, providers: [...config.providers, provider] };
}

export function updateSharedProvider(
  config: SharedLlmConfigV1,
  id: string,
  patch: Partial<Omit<LlmProviderV1, "id">>,
): SharedLlmConfigV1 {
  return {
    ...config,
    providers: config.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

/**
 * Removes a provider. Presets that referenced it are left in place (dangling)
 * rather than cascade-deleted — resolvePreset/resolveVoice already treat a
 * missing provider as an unresolvable target, and leaving the preset record
 * around means re-adding the same provider later heals the reference. The
 * one exception: if the current default preset's provider is the one being
 * removed, defaultPresetId is cleared so the app doesn't keep pointing at a
 * target that can no longer resolve.
 */
export function removeSharedProvider(config: SharedLlmConfigV1, id: string): SharedLlmConfigV1 {
  const providers = config.providers.filter((p) => p.id !== id);
  const defaultPreset = config.presets.find((p) => p.id === config.defaultPresetId);
  const defaultPresetId = defaultPreset && defaultPreset.providerId === id ? "" : config.defaultPresetId;
  return { ...config, providers, defaultPresetId };
}

export function addSharedPreset(config: SharedLlmConfigV1, preset: ModelPresetV1): SharedLlmConfigV1 {
  return { ...config, presets: [...config.presets, preset] };
}

export function updateSharedPreset(
  config: SharedLlmConfigV1,
  id: string,
  patch: Partial<Omit<ModelPresetV1, "id">>,
): SharedLlmConfigV1 {
  return {
    ...config,
    presets: config.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

export function removeSharedPreset(config: SharedLlmConfigV1, id: string): SharedLlmConfigV1 {
  return {
    ...config,
    presets: config.presets.filter((p) => p.id !== id),
    defaultPresetId: config.defaultPresetId === id ? "" : config.defaultPresetId,
  };
}

export function setDefaultPresetId(config: SharedLlmConfigV1, id: string): SharedLlmConfigV1 {
  return { ...config, defaultPresetId: id };
}

export function setSharedNetworkRoomId(config: SharedLlmConfigV1, roomId: string): SharedLlmConfigV1 {
  return { ...config, network: { roomId: roomId.trim() } };
}
