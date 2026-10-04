import { useMemo, useState } from "preact/hooks";
import { useLlmConfig, type LlmLocalSettings, type LlmSettingsLocalAdapter } from "@tik-choco/mistai/preact";
import { loadLlmSettings, saveLlmSettings } from "../lib/llmSettings";

export function useLlmSettings() {
  const [settings, setSettings] = useState<LlmLocalSettings>(() => loadLlmSettings());
  const { config: shared } = useLlmConfig();
  const localAdapter = useMemo<LlmSettingsLocalAdapter>(() => ({
    get: () => settings,
    set: next => { saveLlmSettings(next); setSettings(next); },
  }), [settings]);
  return { settings, shared, localAdapter };
}
