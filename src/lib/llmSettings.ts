import {
  createProvider, createRoomProvider, emptyLlmConfig, isModelRef,
  loadLlmConfig, migrateSharedLlmConfig, normalizeBaseUrl, patchProvider,
  presetIdToRef, providerKind, saveLlmConfig, type ModelRefV1,
} from "@tik-choco/mistai/llm-config";
import { fetchModels as fetchMistaiModels } from "@tik-choco/mistai";
import type { LlmLocalSettings, ReasoningEffort, TaskModelV1 } from "@tik-choco/mistai/preact";

const SETTINGS_KEY = "tc-note:llm-settings";
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export type LlmSettings = LlmLocalSettings & { migrationVersion: 2 };
export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  migrationVersion: 2,
  tasks: { default: { reasoningEffort: "none" }, embedding: { reasoningEffort: "none" } },
  roomProvide: {}, recentModels: [],
};

function effort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && EFFORTS.includes(value) ? value as ReasoningEffort : undefined;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function refs(value: unknown): ModelRefV1[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).filter(isModelRef).filter(ref => {
    const key = JSON.stringify([ref.providerId, ref.model]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// Shared legacy fields are migration inputs only. App-local IDs are consumed once.
export function loadLlmSettings(): LlmSettings {
  let stored: Record<string, unknown> = {};
  try { stored = record(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")); } catch { /* defaults */ }
  const config = loadLlmConfig() ?? emptyLlmConfig();
  let changed = migrateSharedLlmConfig(config).changed;
  const migrating = stored.migrationVersion !== 2;
  let oldModelRef: ModelRefV1 | undefined;
  if (migrating) {
    const idMap = new Map<string, string>();
    for (const value of Array.isArray(stored.providers) ? stored.providers : []) {
      const p = record(value);
      if (typeof p.id !== "string" || typeof p.baseUrl !== "string" || typeof p.apiKey !== "string") continue;
      const baseUrl = normalizeBaseUrl(p.baseUrl);
      let id = config.providers.find(row => row.baseUrl === baseUrl && row.apiKey === p.apiKey)?.id;
      if (!id) {
        id = createProvider(config, typeof p.label === "string" ? p.label : baseUrl);
        patchProvider(config, id, { baseUrl, apiKey: p.apiKey }); changed = true;
      }
      idMap.set(p.id, id);
    }
    const active = idMap.get(String(stored.activeProviderId ?? ""));
    if (active && typeof stored.llmModel === "string" && stored.llmModel.trim()) {
      oldModelRef = { providerId: active, model: stored.llmModel.trim() };
      const p = config.providers.find(p => p.id === active)!;
      if (!p.models?.includes(oldModelRef.model)) { p.models = [...p.models ?? [], oldModelRef.model]; changed = true; }
      if (!config.defaultModel) { config.defaultModel = oldModelRef; changed = true; }
    }
    if (typeof stored.networkRoomId === "string" && stored.networkRoomId.trim()) {
      const result = createRoomProvider(config, { roomId: stored.networkRoomId.trim() });
      changed ||= !result.existed;
    }
  }
  if (changed) saveLlmConfig(config);
  const tasks: Record<string, TaskModelV1> = {};
  const oldTasks = record(stored.tasks);
  for (const id of new Set(["default", "embedding", ...Object.keys(oldTasks)])) {
    const task = record(oldTasks[id]);
    const legacyId = typeof oldTasks[id] === "string" ? oldTasks[id]
      : task.presetId ?? (id === "default" ? stored.defaultPresetId ?? stored.presetId : undefined);
    const ref = isModelRef(task.ref) ? task.ref
      : migrating && typeof legacyId === "string" ? presetIdToRef(config, legacyId) : undefined;
    const preset = migrating ? config.presets.find(p => p.id === (legacyId ?? (id === "default" ? config.defaultPresetId : undefined))) : undefined;
    tasks[id] = {
      ...(ref ? { ref } : id === "default" && oldModelRef ? { ref: oldModelRef } : {}),
      reasoningEffort: effort(task.reasoningEffort) ?? (id === "default" ? effort(stored.reasoningEffort) : undefined)
        ?? effort(preset?.reasoningEffort) ?? "none",
    };
  }
  if (migrating && stored.connection === "network" && !oldTasks.default && !stored.defaultPresetId && !stored.presetId) {
    const roomId = String(stored.networkRoomId || config.network.roomId || "");
    const room = config.providers.find(p => p.baseUrl === `mist-network://${roomId}`);
    const model = config.defaultModel?.model;
    if (room && model) tasks.default.ref = { providerId: room.id, model };
  }
  if (migrating && typeof stored.embeddingModel === "string" && stored.embeddingModel.trim()) {
    const providerId = config.defaultModel?.providerId;
    if (providerId && !tasks.embedding.ref) tasks.embedding.ref = { providerId, model: stored.embeddingModel.trim() };
  }
  const roomProvide: LlmLocalSettings["roomProvide"] = {};
  for (const [id, value] of Object.entries(record(stored.roomProvide))) {
    const row = record(value);
    roomProvide[id] = { enabled: row.enabled === true, shared: refs(row.shared) };
  }
  if (migrating) {
    const roomId = String(stored.networkRoomId || config.network.roomId || "");
    const room = config.providers.find(p => p.baseUrl === `mist-network://${roomId}`);
    if (room && !roomProvide[room.id]) {
      const ids = stored.sharedPresetIds ?? stored.networkSharedPresetIds;
      const shared = Array.isArray(ids) ? ids.flatMap(id => {
        const ref = typeof id === "string" ? presetIdToRef(config, id) : undefined;
        return ref && config.providers.some(p => p.id === ref.providerId && providerKind(p) === "http") ? [ref] : [];
      }) : config.defaultModel && config.providers.some(p => p.id === config.defaultModel?.providerId && providerKind(p) === "http")
        ? [config.defaultModel] : [];
      roomProvide[room.id] = { enabled: stored.networkProviderEnabled === true || stored.providerModeEnabled === true, shared: refs(shared) };
    }
  }
  const settings: LlmSettings = { migrationVersion: 2, tasks, roomProvide, recentModels: refs(stored.recentModels).slice(0, 8) };
  if (migrating) saveLlmSettings(settings);
  return settings;
}

export function saveLlmSettings(settings: LlmLocalSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, migrationVersion: 2 }));
}

export async function fetchModels(target: { baseUrl: string; apiKey: string }): Promise<string[]> {
  return [...await fetchMistaiModels(target)].sort((a, b) => a.localeCompare(b));
}
