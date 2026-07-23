import { REASONING_EFFORT_OPTIONS, type LlmSettings, type ReasoningEffort } from "../lib/llmSettings";
import type { SharedLlmConfigV1 } from "../lib/llmConfig";
import { isNetworkProviderBaseUrl } from "../lib/networkModels";
import { useT } from "../hooks/useAppSettings";

export type LlmTasksPanelProps = {
  settings: LlmSettings;
  /** The shared, co-owned tc-shared-llm-config-v1 config — read here for its
   * `presets`/`defaultPresetId` (the "which preset backs the default task"
   * assignment), same source the Connection tab's provider/preset editors own. */
  shared: SharedLlmConfigV1;
  onSetDefaultPresetId: (id: string) => void;
  onSetEmbeddingModel: (model: string | null) => void;
  onSetReasoningEffort: (effort: ReasoningEffort) => void;
  /** Whether the AI Network transport can actually run right now
   * (useLlmNet's `networkAvailable`) — gates whether a `mist-network://`-backed
   * preset (synced in from another tik-choco app's AI Network room; see
   * lib/networkModels.ts) is offered as selectable here, same idea as
   * tc-translate's SettingsModal.tsx `networkConnected` guard. */
  networkConnected: boolean;
};

// "Tasks" tab body: use-case -> model assignment, tc-translate's row layout
// (llm-settings-common-v1.md §3.2 — a short `data-tip`-tooltipped label
// paired with its select/input controls, not an always-visible description
// column). tc-note only ever routes every LLM call (chat, review, the
// translate-on-select popover — see App.tsx's single `llmNet`) through one
// resolved preset, so there is exactly one LLM task ("default") rather than
// tc-translate's default/vision split; the embedding model id (still not
// wired into any call site) gets the same row treatment for visual
// consistency, per the guide's "align existing app-local rows to the same
// row format" note. No TTS/STT/mic rows — tc-note has no LLM-configured
// voice feature (TranslateHoverLayer's "listen" button is the browser's own
// Web Speech API `speechSynthesis`, unrelated to any configured provider).
export function LlmTasksPanel(props: LlmTasksPanelProps) {
  const { settings, shared, onSetDefaultPresetId, onSetEmbeddingModel, onSetReasoningEffort, networkConnected } =
    props;
  const t = useT();

  function isNetworkPresetProvider(providerId: string): boolean {
    const provider = shared.providers.find((p) => p.id === providerId);
    return provider ? isNetworkProviderBaseUrl(provider.baseUrl) : false;
  }

  function isNetworkPreset(presetId: string): boolean {
    const preset = shared.presets.find((p) => p.id === presetId);
    return preset ? isNetworkPresetProvider(preset.providerId) : false;
  }

  return (
    <div class="llm-tasks-section">
      <div class="task-model-item">
        <span data-tip={t("llmSettings.tasksDefaultModelDesc")}>{t("llmSettings.tasksDefaultModelLabel")}</span>
        <div class="task-model-fields">
          <div class="task-model-field">
            {shared.presets.length === 0 ? (
              <p class="llm-tasks-empty">{t("llmSettings.noPresets")}</p>
            ) : (
              <div class="task-model-select-row">
                <select
                  value={shared.defaultPresetId}
                  onChange={(e) => onSetDefaultPresetId((e.target as HTMLSelectElement).value)}
                  aria-label={t("llmSettings.tasksDefaultModelLabel")}
                >
                  <option value="">{t("llmSettings.selectPlaceholder")}</option>
                  {shared.presets
                    .filter((preset) => networkConnected || !isNetworkPresetProvider(preset.providerId))
                    .map((preset) => (
                      <option
                        key={preset.id}
                        value={preset.id}
                        class={isNetworkPresetProvider(preset.providerId) ? "option-network" : undefined}
                      >
                        {preset.label || preset.model}
                      </option>
                    ))}
                </select>
                {networkConnected && isNetworkPreset(shared.defaultPresetId) ? (
                  <span class="task-badge task-badge-network">{t("llmSettings.presetNetworkBadge")}</span>
                ) : null}
              </div>
            )}
          </div>
          <div class="task-model-field">
            <select
              value={settings.reasoningEffort}
              onChange={(e) => onSetReasoningEffort((e.target as HTMLSelectElement).value as ReasoningEffort)}
              aria-label={t("llmSettings.reasoningEffortLabel")}
              title={t("llmSettings.reasoningEffortLabel")}
            >
              {REASONING_EFFORT_OPTIONS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div class="task-model-item">
        <span data-tip={t("llmSettings.tasksEmbeddingModelDesc")}>{t("llmSettings.embeddingModelLabel")}</span>
        <div class="task-model-fields">
          <div class="task-model-field">
            <input
              placeholder={t("llmSettings.modelIdPlaceholder")}
              value={settings.embeddingModel ?? ""}
              onInput={(e) => onSetEmbeddingModel((e.target as HTMLInputElement).value || null)}
              aria-label={t("llmSettings.embeddingModelLabel")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
