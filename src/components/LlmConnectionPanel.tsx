import { useRef, useState } from "preact/hooks";
import { formatMistaiError, MESSAGES_EN, MESSAGES_JA } from "@tik-choco/mistai";
import { fetchModels, type LlmSettings } from "../lib/llmSettings";
import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "../lib/llmConfig";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { pickFocusAfterUnmount } from "../lib/util";
import { Icon } from "./Icon";

export type LlmConnectionPanelProps = {
  settings: LlmSettings;
  /** The shared, co-owned tc-shared-llm-config-v1 config (providers/presets/defaultPresetId/network.roomId). */
  shared: SharedLlmConfigV1;
  onAddProvider: (provider: LlmProviderV1) => void;
  onUpdateProvider: (id: string, patch: Partial<Omit<LlmProviderV1, "id">>) => void;
  onRemoveProvider: (id: string) => void;
  onAddPreset: (preset: ModelPresetV1) => void;
  onUpdatePreset: (id: string, patch: Partial<Omit<ModelPresetV1, "id">>) => void;
  onRemovePreset: (id: string) => void;
};

// "Connection" tab body for the shared LLM config (tc-shared-llm-config-v1):
// a grid of provider cards ("where to connect" — label/baseUrl/apiKey) and a
// grid of named model-preset cards ("how to call it" — label/provider/model/
// temperature), each editable in place. Visually ported from tc-translate's
// SettingsModal connection tab (grid-card layout, dashed "add" tile, round
// remove chip) but keeps tc-note's existing preset editor fields and its
// discrete Save/Cancel (rather than tc-translate's commit-on-blur) editing
// model. Which preset is the default now lives in the Tasks tab (shown here
// only as a badge on the matching card) — this panel only manages the raw
// providers/presets lists. reasoningEffort is intentionally no longer edited
// per-preset: it moved to the Tasks tab as an app-local per-task setting (see
// llm-settings-common-v1.md §3.2/§4.1 and lib/llmSettings.ts's
// `reasoningEffort` field) — a preset's own legacy `reasoningEffort` value
// (if any, from before this change) is left in place untouched rather than
// cleared, since it's a cross-app shared record nothing here still reads for
// the actual request. Rendered as the "Connection" tab inside SettingsModal
// — no dialog chrome of its own.
export function LlmConnectionPanel(props: LlmConnectionPanelProps) {
  const { shared, onAddProvider, onUpdateProvider, onRemoveProvider, onAddPreset, onUpdatePreset, onRemovePreset } =
    props;

  const t = useT();
  const { language } = useAppSettings();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;

  // --- Providers editor state ---
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");

  // Unlike a flat list where the edit/add form renders as a separate block
  // below (and each row's own button stays mounted throughout), each card
  // here morphs in place into its edit form — so a card being edited can't
  // serve as its own post-close focus target (it isn't rendered as a button
  // while it's the thing being edited). The grid container itself is always
  // present regardless of add/edit state, so it's the fallback focus target
  // (tabIndex=-1, focused imperatively) — same "never let focus fall to
  // <body>" goal as LlmSettingsPanel's pickFocusAfterUnmount, just anchored
  // to a stable container instead of a stable button.
  const providerGridRef = useRef<HTMLDivElement | null>(null);
  const editProviderButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusAfterProviderFormClose(id: string | null) {
    pickFocusAfterUnmount<HTMLButtonElement | HTMLDivElement>(
      id,
      editProviderButtonRefs.current,
      providerGridRef.current,
    )?.focus();
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

  // The delete chip's card is about to unmount; move focus to the grid
  // fallback first so it doesn't fall through to <body>.
  function removeProvider(id: string) {
    onRemoveProvider(id);
    providerGridRef.current?.focus();
  }

  // --- Presets editor state ---
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftPresetLabel, setDraftPresetLabel] = useState("");
  const [draftPresetProviderId, setDraftPresetProviderId] = useState("");
  const [draftPresetModel, setDraftPresetModel] = useState("");
  const [draftPresetTemperature, setDraftPresetTemperature] = useState("");
  const [presetModels, setPresetModels] = useState<string[]>([]);
  const [presetModelsLoading, setPresetModelsLoading] = useState(false);
  const [presetModelsError, setPresetModelsError] = useState<string | null>(null);

  const presetGridRef = useRef<HTMLDivElement | null>(null);
  const editPresetButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusAfterPresetFormClose(id: string | null) {
    pickFocusAfterUnmount<HTMLButtonElement | HTMLDivElement>(
      id,
      editPresetButtonRefs.current,
      presetGridRef.current,
    )?.focus();
  }

  function startAddPreset() {
    setEditingPresetId("new");
    setDraftPresetLabel("");
    setDraftPresetProviderId(shared.providers[0]?.id ?? "");
    setDraftPresetModel("");
    setDraftPresetTemperature("");
    setPresetModels([]);
    setPresetModelsError(null);
  }

  function startEditPreset(preset: ModelPresetV1) {
    setEditingPresetId(preset.id);
    setDraftPresetLabel(preset.label);
    setDraftPresetProviderId(preset.providerId);
    setDraftPresetModel(preset.model);
    setDraftPresetTemperature(preset.temperature !== undefined ? String(preset.temperature) : "");
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
    const temperature =
      draftPresetTemperature.trim() === "" || Number.isNaN(parsedTemperature) ? undefined : parsedTemperature;

    if (editingPresetId === "new") {
      onAddPreset({ id: crypto.randomUUID(), label, providerId, model, temperature });
    } else if (editingPresetId) {
      onUpdatePreset(editingPresetId, { label, providerId, model, temperature });
    }
    focusAfterPresetFormClose(editingPresetId);
    setEditingPresetId(null);
  }

  function removePreset(id: string) {
    onRemovePreset(id);
    presetGridRef.current?.focus();
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

  // presetModels is only ever populated by an explicit "fetch model list"
  // click (unlike tc-translate, which auto-fetches on open) — mirrors
  // LlmSettingsPanel's getModelSelectionState/fetchModels flow exactly, just
  // scoped to the single in-flight edit/add form (there's at most one open
  // at a time) rather than keyed per-provider.
  function getPresetModelSelectionState(): { isLoading: boolean; models: string[]; mode: "select" | "manual" } {
    return {
      isLoading: presetModelsLoading,
      models: presetModels,
      mode: presetModels.length > 0 ? "select" : "manual",
    };
  }

  // Shared body for both the "edit an existing preset" card and the "add a
  // new preset" card — same field set as LlmSettingsPanel's preset form
  // (label / provider select / model select-or-manual + fetch-models button
  // / temperature / reasoning effort), just laid out inside a grid card
  // instead of a flat section.
  function renderPresetFormFields() {
    const { mode: modelMode, isLoading: modelsLoading, models } = getPresetModelSelectionState();
    return (
      <>
        <div class="llm-connection-form-fields">
          <input
            placeholder={t("llmSettings.presetLabelPlaceholder")}
            value={draftPresetLabel}
            onInput={(e) => setDraftPresetLabel((e.target as HTMLInputElement).value)}
          />
          <label class="llm-connection-form-row">
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

          <button
            type="button"
            class="llm-connection-btn"
            onClick={handleFetchPresetModels}
            disabled={!draftPresetProviderId || presetModelsLoading}
          >
            {presetModelsLoading ? t("llmSettings.fetchingModels") : t("llmSettings.fetchModels")}
          </button>
          {presetModelsError && <div class="llm-connection-error">{presetModelsError}</div>}

          <label class="llm-connection-form-row">
            <span>{t("llmSettings.llmModelLabel")}</span>
            {modelMode === "select" ? (
              <select
                value={draftPresetModel}
                onChange={(e) => setDraftPresetModel((e.target as HTMLSelectElement).value)}
              >
                <option value="">{t("llmSettings.selectPlaceholder")}</option>
                {draftPresetModel && !models.includes(draftPresetModel) && (
                  <option value={draftPresetModel}>{t("llmSettings.notInList", { model: draftPresetModel })}</option>
                )}
                {models.map((m) => (
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
                disabled={modelsLoading}
              />
            )}
          </label>

          <label class="llm-connection-form-row">
            <span>{t("llmSettings.temperatureLabel")}</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={t("llmSettings.temperaturePlaceholder")}
              value={draftPresetTemperature}
              onInput={(e) => setDraftPresetTemperature((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="llm-connection-form-actions">
          <button
            type="button"
            class="llm-connection-btn llm-connection-btn-primary"
            onClick={savePresetDraft}
            disabled={!draftPresetLabel.trim() || !draftPresetProviderId || !draftPresetModel.trim()}
          >
            {t("llmSettings.save")}
          </button>
          <button type="button" class="llm-connection-btn" onClick={cancelEditPreset}>
            {t("llmSettings.cancel")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div class="llm-connection-section">
        <div class="llm-connection-section-header">
          <span>{t("llmSettings.providersLabel")}</span>
        </div>
        {shared.providers.length === 0 && editingProviderId === null && (
          <p class="llm-connection-hint">{t("llmSettings.noProviders")}</p>
        )}
        <div class="llm-connection-grid" ref={providerGridRef} tabIndex={-1}>
          {shared.providers.map((provider) => {
            if (editingProviderId === provider.id) {
              return (
                <div class="llm-connection-card llm-connection-card-editing" key={provider.id}>
                  <div class="llm-connection-form-fields">
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
                  </div>
                  <div class="llm-connection-form-actions">
                    <button
                      type="button"
                      class="llm-connection-btn llm-connection-btn-primary"
                      onClick={saveProviderDraft}
                      disabled={!draftLabel.trim() || !draftBaseUrl.trim()}
                    >
                      {t("llmSettings.save")}
                    </button>
                    <button type="button" class="llm-connection-btn" onClick={cancelEditProvider}>
                      {t("llmSettings.cancel")}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div class="llm-connection-card" key={provider.id}>
                <button
                  type="button"
                  class="llm-connection-card-main"
                  ref={(el) => {
                    editProviderButtonRefs.current[provider.id] = el as HTMLButtonElement | null;
                  }}
                  onClick={() => startEditProvider(provider)}
                >
                  <span class="llm-connection-card-label">{provider.label}</span>
                  <span class="llm-connection-card-sub">{provider.baseUrl}</span>
                </button>
                <span
                  class="llm-connection-card-remove"
                  role="button"
                  tabIndex={0}
                  title={t("llmSettings.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProvider(provider.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      removeProvider(provider.id);
                    }
                  }}
                >
                  <Icon name="close" size={13} />
                </span>
              </div>
            );
          })}

          {editingProviderId === "new" ? (
            <div class="llm-connection-card llm-connection-card-editing">
              <div class="llm-connection-form-fields">
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
              </div>
              <div class="llm-connection-form-actions">
                <button
                  type="button"
                  class="llm-connection-btn llm-connection-btn-primary"
                  onClick={saveProviderDraft}
                  disabled={!draftLabel.trim() || !draftBaseUrl.trim()}
                >
                  {t("llmSettings.save")}
                </button>
                <button type="button" class="llm-connection-btn" onClick={cancelEditProvider}>
                  {t("llmSettings.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" class="llm-connection-add-tile" onClick={startAddProvider}>
              <Icon name="add" size={16} />
              <span>{t("llmSettings.addProvider")}</span>
            </button>
          )}
        </div>
      </div>

      <div class="llm-connection-section">
        <div class="llm-connection-section-header">
          <span>{t("llmSettings.presetsLabel")}</span>
        </div>
        {shared.providers.length === 0 && <p class="llm-connection-hint">{t("llmSettings.noProvidersForPreset")}</p>}
        <div class="llm-connection-grid" ref={presetGridRef} tabIndex={-1}>
          {shared.presets.map((preset) => {
            if (editingPresetId === preset.id) {
              return (
                <div class="llm-connection-card llm-connection-card-editing" key={preset.id}>
                  {renderPresetFormFields()}
                </div>
              );
            }

            return (
              <div class="llm-connection-card" key={preset.id}>
                <button
                  type="button"
                  class="llm-connection-card-main"
                  ref={(el) => {
                    editPresetButtonRefs.current[preset.id] = el as HTMLButtonElement | null;
                  }}
                  onClick={() => startEditPreset(preset)}
                >
                  <span class="llm-connection-card-label">{preset.label}</span>
                  <span class="llm-connection-card-sub">{preset.model}</span>
                  <span class="llm-connection-card-provider">{providerLabel(preset.providerId)}</span>
                  {shared.defaultPresetId === preset.id && (
                    <span class="llm-connection-card-badges">
                      <span class="task-badge">{t("llmSettings.presetDefaultBadge")}</span>
                    </span>
                  )}
                </button>
                <span
                  class="llm-connection-card-remove"
                  role="button"
                  tabIndex={0}
                  title={t("llmSettings.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreset(preset.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      removePreset(preset.id);
                    }
                  }}
                >
                  <Icon name="close" size={13} />
                </span>
              </div>
            );
          })}

          {editingPresetId === "new" ? (
            <div class="llm-connection-card llm-connection-card-editing">{renderPresetFormFields()}</div>
          ) : (
            <button
              type="button"
              class="llm-connection-add-tile"
              onClick={startAddPreset}
              disabled={shared.providers.length === 0}
              title={shared.providers.length === 0 ? t("llmSettings.noProvidersForPreset") : undefined}
            >
              <Icon name="add" size={16} />
              <span>{t("llmSettings.addPreset")}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
