import { useRef, useState } from "preact/hooks";
import { formatMistaiError, MESSAGES_EN, MESSAGES_JA } from "@tik-choco/mistai";
import { ConsumerStatusIndicator, ProviderStatusPanel } from "@tik-choco/mistai/preact";
import { fetchModels, type LlmConnection, type LlmSettings } from "../lib/llmSettings";
import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "../lib/llmConfig";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import type { UseLlmNetResult } from "../hooks/useLlmNet";
import { pickFocusAfterUnmount } from "../lib/util";
import { Icon } from "./Icon";

export type LlmSettingsPanelProps = {
  settings: LlmSettings;
  /** The shared, co-owned tc-shared-llm-config-v1 config (providers/presets/defaultPresetId/network.roomId). */
  shared: SharedLlmConfigV1;
  onAddProvider: (provider: LlmProviderV1) => void;
  onUpdateProvider: (id: string, patch: Partial<Omit<LlmProviderV1, "id">>) => void;
  onRemoveProvider: (id: string) => void;
  onAddPreset: (preset: ModelPresetV1) => void;
  onUpdatePreset: (id: string, patch: Partial<Omit<ModelPresetV1, "id">>) => void;
  onRemovePreset: (id: string) => void;
  onSetDefaultPresetId: (id: string) => void;
  onSetEmbeddingModel: (model: string | null) => void;
  onSetConnection: (connection: LlmConnection) => void;
  onSetProviderModeEnabled: (enabled: boolean) => void;
  onSetNetworkRoomId: (roomId: string) => void;
  /** Live AI Network state, for the shared status UI in the AI Network section — its networkAvailable/networkSource already account for whether a collab room is joined. */
  net: UseLlmNetResult;
};

// Settings body for the shared LLM config (tc-shared-llm-config-v1): manage a
// list of providers (label/baseUrl/apiKey — "where to connect"), a list of
// named presets referencing a provider (label/model/temperature/
// reasoningEffort — "how to call it"), and which preset is the default. Also
// owns the app-local bits (embedding model, transport, AI Network room/
// provider mode). Rendered as the "AI" tab inside SettingsModal — no dialog
// chrome of its own; the surrounding modal owns the overlay, header, and
// focus management.
export function LlmSettingsPanel(props: LlmSettingsPanelProps) {
  const {
    settings,
    shared,
    onAddProvider,
    onUpdateProvider,
    onRemoveProvider,
    onAddPreset,
    onUpdatePreset,
    onRemovePreset,
    onSetDefaultPresetId,
    onSetEmbeddingModel,
    onSetConnection,
    onSetProviderModeEnabled,
    onSetNetworkRoomId,
    net,
  } = props;

  const t = useT();
  const { language } = useAppSettings();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;

  // --- Providers editor state ---
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");

  // Targets for restoring focus after the provider form (Save/Cancel) or a
  // provider's own row unmounts. Without this, focus — which was on the
  // control the user just clicked — falls back to <body>, silently breaking
  // the Tab trap in useModalA11y until the next Tab press. The add ("+")
  // button is a stable, always-present fallback; per-provider edit buttons
  // stay put across a save/cancel of *that same* provider's form.
  const addProviderButtonRef = useRef<HTMLButtonElement | null>(null);
  const editProviderButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusAfterProviderFormClose(id: string | null) {
    pickFocusAfterUnmount(id, editProviderButtonRefs.current, addProviderButtonRef.current)?.focus();
  }

  function startAddProvider() {
    setEditingProviderId("new");
    setDraftLabel("");
    setDraftBaseUrl("");
    setDraftApiKey("");
  }

  function startEditProvider(provider: LlmProviderV1) {
    setEditingProviderId(provider.id);
    setDraftLabel(provider.label);
    setDraftBaseUrl(provider.baseUrl);
    setDraftApiKey(provider.apiKey);
  }

  function cancelEditProvider() {
    focusAfterProviderFormClose(editingProviderId);
    setEditingProviderId(null);
  }

  function saveProviderDraft() {
    if (!draftLabel.trim() || !draftBaseUrl.trim()) return;
    if (editingProviderId === "new") {
      onAddProvider({
        id: crypto.randomUUID(),
        label: draftLabel.trim(),
        baseUrl: draftBaseUrl.trim(),
        apiKey: draftApiKey,
      });
    } else if (editingProviderId) {
      onUpdateProvider(editingProviderId, {
        label: draftLabel.trim(),
        baseUrl: draftBaseUrl.trim(),
        apiKey: draftApiKey,
      });
    }
    focusAfterProviderFormClose(editingProviderId);
    setEditingProviderId(null);
  }

  // The delete button itself is about to unmount along with the provider's
  // <li>; move focus to the add button first so it doesn't fall through to
  // <body> (see focusAfterProviderFormClose above for the same issue on the form).
  function removeProvider(id: string) {
    onRemoveProvider(id);
    addProviderButtonRef.current?.focus();
  }

  // --- Presets editor state ---
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftPresetLabel, setDraftPresetLabel] = useState("");
  const [draftPresetProviderId, setDraftPresetProviderId] = useState("");
  const [draftPresetModel, setDraftPresetModel] = useState("");
  const [draftPresetTemperature, setDraftPresetTemperature] = useState("");
  const [draftPresetReasoningEffort, setDraftPresetReasoningEffort] = useState("");
  const [presetModels, setPresetModels] = useState<string[]>([]);
  const [presetModelsLoading, setPresetModelsLoading] = useState(false);
  const [presetModelsError, setPresetModelsError] = useState<string | null>(null);

  const addPresetButtonRef = useRef<HTMLButtonElement | null>(null);
  const editPresetButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusAfterPresetFormClose(id: string | null) {
    pickFocusAfterUnmount(id, editPresetButtonRefs.current, addPresetButtonRef.current)?.focus();
  }

  function startAddPreset() {
    setEditingPresetId("new");
    setDraftPresetLabel("");
    setDraftPresetProviderId(shared.providers[0]?.id ?? "");
    setDraftPresetModel("");
    setDraftPresetTemperature("");
    setDraftPresetReasoningEffort("");
    setPresetModels([]);
    setPresetModelsError(null);
  }

  function startEditPreset(preset: ModelPresetV1) {
    setEditingPresetId(preset.id);
    setDraftPresetLabel(preset.label);
    setDraftPresetProviderId(preset.providerId);
    setDraftPresetModel(preset.model);
    setDraftPresetTemperature(preset.temperature !== undefined ? String(preset.temperature) : "");
    setDraftPresetReasoningEffort(preset.reasoningEffort ?? "");
    setPresetModels([]);
    setPresetModelsError(null);
  }

  function cancelEditPreset() {
    focusAfterPresetFormClose(editingPresetId);
    setEditingPresetId(null);
  }

  function savePresetDraft() {
    if (!draftPresetLabel.trim() || !draftPresetProviderId || !draftPresetModel.trim()) return;
    const label = draftPresetLabel.trim();
    const providerId = draftPresetProviderId;
    const model = draftPresetModel.trim();
    const parsedTemperature = Number(draftPresetTemperature.trim());
    const temperature = draftPresetTemperature.trim() === "" || Number.isNaN(parsedTemperature) ? undefined : parsedTemperature;
    const reasoningEffort = draftPresetReasoningEffort.trim() || undefined;

    if (editingPresetId === "new") {
      onAddPreset({ id: crypto.randomUUID(), label, providerId, model, temperature, reasoningEffort });
    } else if (editingPresetId) {
      onUpdatePreset(editingPresetId, { label, providerId, model, temperature, reasoningEffort });
    }
    focusAfterPresetFormClose(editingPresetId);
    setEditingPresetId(null);
  }

  function removePreset(id: string) {
    onRemovePreset(id);
    addPresetButtonRef.current?.focus();
  }

  async function handleFetchPresetModels() {
    const provider = shared.providers.find((p) => p.id === draftPresetProviderId);
    if (!provider) return;
    setPresetModelsLoading(true);
    setPresetModelsError(null);
    try {
      const ids = await fetchModels(provider);
      setPresetModels(ids);
    } catch (err) {
      // fetchModels throws MistaiError — surface it in the current language
      // via the shared catalog rather than showing the raw (English) message.
      setPresetModelsError(formatMistaiError(err, mistaiMessages, t("llmSettings.fetchModelsError")));
    } finally {
      setPresetModelsLoading(false);
    }
  }

  function providerLabel(providerId: string): string {
    const provider = shared.providers.find((p) => p.id === providerId);
    return provider ? provider.label : t("llmSettings.unknownProvider");
  }

  return (
    <>
      <div class="llm-settings-section">
        <div class="llm-settings-section-header">
          <span>{t("llmSettings.providersLabel")}</span>
          <button
            type="button"
            class="icon-btn"
            ref={addProviderButtonRef}
            onClick={startAddProvider}
            title={t("llmSettings.addProvider")}
          >
            <Icon name="add" size={16} />
          </button>
        </div>
        <ul class="llm-provider-list">
          {shared.providers.map((provider) => (
            <li key={provider.id} class="llm-provider-item">
              <span class="llm-provider-radio">
                <span>{provider.label}</span>
                <span class="llm-provider-url">{provider.baseUrl}</span>
              </span>
              <div class="llm-provider-actions">
                <button
                  type="button"
                  class="icon-btn"
                  ref={(el) => {
                    editProviderButtonRefs.current[provider.id] = el as HTMLButtonElement | null;
                  }}
                  onClick={() => startEditProvider(provider)}
                  title={t("llmSettings.edit")}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  onClick={() => removeProvider(provider.id)}
                  title={t("llmSettings.delete")}
                >
                  <Icon name="delete" size={15} />
                </button>
              </div>
            </li>
          ))}
          {shared.providers.length === 0 && editingProviderId === null && (
            <li class="llm-provider-empty">{t("llmSettings.noProviders")}</li>
          )}
        </ul>

        {editingProviderId !== null && (
          <div class="llm-provider-form">
            <input
              placeholder={t("llmSettings.labelPlaceholder")}
              value={draftLabel}
              onInput={(e) => setDraftLabel((e.target as HTMLInputElement).value)}
            />
            <input
              placeholder={t("llmSettings.baseUrlPlaceholder")}
              value={draftBaseUrl}
              onInput={(e) => setDraftBaseUrl((e.target as HTMLInputElement).value)}
            />
            <input
              type="password"
              placeholder={t("llmSettings.apiKeyPlaceholder")}
              value={draftApiKey}
              onInput={(e) => setDraftApiKey((e.target as HTMLInputElement).value)}
            />
            <div class="llm-provider-form-actions">
              <button type="button" onClick={saveProviderDraft} disabled={!draftLabel.trim() || !draftBaseUrl.trim()}>
                {t("llmSettings.save")}
              </button>
              <button type="button" onClick={cancelEditProvider}>
                {t("llmSettings.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="llm-settings-section">
        <div class="llm-settings-section-header">
          <span>{t("llmSettings.presetsLabel")}</span>
          <button
            type="button"
            class="icon-btn"
            ref={addPresetButtonRef}
            onClick={startAddPreset}
            disabled={shared.providers.length === 0}
            title={t("llmSettings.addPreset")}
          >
            <Icon name="add" size={16} />
          </button>
        </div>
        {shared.providers.length === 0 && (
          <div class="llm-settings-hint">{t("llmSettings.noProvidersForPreset")}</div>
        )}
        <div class="llm-settings-hint">{t("llmSettings.defaultPresetHint")}</div>
        <ul class="llm-provider-list">
          {shared.presets.map((preset) => (
            <li key={preset.id} class="llm-provider-item">
              <label class="llm-provider-radio">
                <input
                  type="radio"
                  name="default-preset"
                  checked={shared.defaultPresetId === preset.id}
                  onChange={() => onSetDefaultPresetId(preset.id)}
                />
                <span>
                  {preset.label} <span class="llm-provider-url">({preset.model})</span>
                </span>
                <span class="llm-provider-url">{providerLabel(preset.providerId)}</span>
              </label>
              <div class="llm-provider-actions">
                <button
                  type="button"
                  class="icon-btn"
                  ref={(el) => {
                    editPresetButtonRefs.current[preset.id] = el as HTMLButtonElement | null;
                  }}
                  onClick={() => startEditPreset(preset)}
                  title={t("llmSettings.edit")}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  onClick={() => removePreset(preset.id)}
                  title={t("llmSettings.delete")}
                >
                  <Icon name="delete" size={15} />
                </button>
              </div>
            </li>
          ))}
          {shared.presets.length === 0 && editingPresetId === null && (
            <li class="llm-provider-empty">{t("llmSettings.noPresets")}</li>
          )}
        </ul>

        {editingPresetId !== null && (
          <div class="llm-provider-form">
            <input
              placeholder={t("llmSettings.presetLabelPlaceholder")}
              value={draftPresetLabel}
              onInput={(e) => setDraftPresetLabel((e.target as HTMLInputElement).value)}
            />
            <label class="llm-settings-row">
              <span>{t("llmSettings.presetProviderLabel")}</span>
              <select
                value={draftPresetProviderId}
                onChange={(e) => {
                  setDraftPresetProviderId((e.target as HTMLSelectElement).value);
                  setPresetModels([]);
                }}
              >
                <option value="">{t("llmSettings.selectPlaceholder")}</option>
                {shared.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" onClick={handleFetchPresetModels} disabled={!draftPresetProviderId || presetModelsLoading}>
              {presetModelsLoading ? t("llmSettings.fetchingModels") : t("llmSettings.fetchModels")}
            </button>
            {presetModelsError && <div class="llm-settings-error">{presetModelsError}</div>}

            <label class="llm-settings-row">
              <span>{t("llmSettings.llmModelLabel")}</span>
              {presetModels.length > 0 ? (
                <select
                  value={draftPresetModel}
                  onChange={(e) => setDraftPresetModel((e.target as HTMLSelectElement).value)}
                >
                  <option value="">{t("llmSettings.selectPlaceholder")}</option>
                  {draftPresetModel && !presetModels.includes(draftPresetModel) && (
                    <option value={draftPresetModel}>{t("llmSettings.notInList", { model: draftPresetModel })}</option>
                  )}
                  {presetModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder={t("llmSettings.modelIdPlaceholder")}
                  value={draftPresetModel}
                  onInput={(e) => setDraftPresetModel((e.target as HTMLInputElement).value)}
                />
              )}
            </label>

            <label class="llm-settings-row">
              <span>{t("llmSettings.temperatureLabel")}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={t("llmSettings.temperaturePlaceholder")}
                value={draftPresetTemperature}
                onInput={(e) => setDraftPresetTemperature((e.target as HTMLInputElement).value)}
              />
            </label>

            <label class="llm-settings-row">
              <span>{t("llmSettings.reasoningEffortLabel")}</span>
              <input
                type="text"
                placeholder={t("llmSettings.reasoningEffortPlaceholder")}
                value={draftPresetReasoningEffort}
                onInput={(e) => setDraftPresetReasoningEffort((e.target as HTMLInputElement).value)}
              />
            </label>

            <div class="llm-provider-form-actions">
              <button
                type="button"
                onClick={savePresetDraft}
                disabled={!draftPresetLabel.trim() || !draftPresetProviderId || !draftPresetModel.trim()}
              >
                {t("llmSettings.save")}
              </button>
              <button type="button" onClick={cancelEditPreset}>
                {t("llmSettings.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="llm-settings-section">
        <div class="llm-settings-section-header">
          <span>{t("llmSettings.embeddingModelLabel")}</span>
        </div>
        <input
          placeholder={t("llmSettings.modelIdPlaceholder")}
          value={settings.embeddingModel ?? ""}
          onInput={(e) => onSetEmbeddingModel((e.target as HTMLInputElement).value || null)}
        />
      </div>

      <div class="llm-settings-section">
        <div class="llm-settings-section-header">
          <span>{t("llmSettings.networkSection")}</span>
        </div>
        <div class="llm-settings-hint">{t("llmSettings.networkTransportNote")}</div>

        <label class="llm-settings-row">
          <span>{t("llmSettings.connectionLabel")}</span>
          <select
            value={settings.connection}
            onChange={(e) => onSetConnection((e.target as HTMLSelectElement).value as LlmConnection)}
          >
            <option value="api">{t("llmSettings.connection.api")}</option>
            <option value="network">{t("llmSettings.connection.network")}</option>
          </select>
        </label>
        {settings.connection === "network" && (
          <label class="llm-settings-row">
            <span>{t("llmSettings.networkRoomIdLabel")}</span>
            <input
              placeholder={t("llmSettings.networkRoomIdPlaceholder")}
              value={shared.network.roomId}
              onInput={(e) => onSetNetworkRoomId((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        {settings.connection === "network" && !net.networkAvailable && !shared.network.roomId.trim() && (
          <div class="llm-settings-hint">{t("llmSettings.networkRoomIdHint")}</div>
        )}
        {settings.connection === "network" && net.dedicatedRoomStatus === "error" && !net.networkAvailable && (
          <div class="llm-settings-error">{t("llmSettings.networkRoomIdConnectError")}</div>
        )}
        {settings.connection === "network" && (net.networkAvailable || shared.network.roomId.trim()) && (
          <ConsumerStatusIndicator status={net.consumerStatus} variant="detailed" messages={mistaiMessages} />
        )}

        <label class="llm-settings-row llm-settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.providerModeEnabled}
            onChange={(e) => onSetProviderModeEnabled((e.target as HTMLInputElement).checked)}
          />
          <span>{t("llmSettings.providerModeLabel")}</span>
        </label>
        <div class="llm-settings-hint">{t("llmSettings.providerModeHint")}</div>
        {settings.providerModeEnabled && !net.apiReady && (
          <div class="llm-settings-error">{t("llmSettings.providerModeNeedsProvider")}</div>
        )}
        {settings.providerModeEnabled && net.apiReady && (
          <ProviderStatusPanel
            status={net.providerModeActive && net.networkAvailable ? "connected" : "idle"}
            peers={net.consumerPeers.map((peer) => ({ ...peer, isConsumer: true }))}
            consumerCount={net.consumerPeers.length}
            logs={net.providerLogs}
            messages={mistaiMessages}
          />
        )}
      </div>
    </>
  );
}
