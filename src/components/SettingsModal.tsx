import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import type { TranslationKey } from "../lib/i18n";
import type { LlmConnection, LlmSettings, ReasoningEffort } from "../lib/llmSettings";
import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "../lib/llmConfig";
import type { UseLlmNetResult } from "../hooks/useLlmNet";
import { Icon } from "./Icon";
import { AppSettingsPanel } from "./AppSettingsPanel";
import { LlmConnectionPanel } from "./LlmConnectionPanel";
import { LlmNetworkPanel } from "./LlmNetworkPanel";
import { LlmTasksPanel } from "./LlmTasksPanel";

export type SettingsTab = "display" | "connection" | "network" | "tasks";

export type SettingsModalProps = {
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
  onSetReasoningEffort: (effort: ReasoningEffort) => void;
  onSetConnection: (connection: LlmConnection) => void;
  onSetProviderModeEnabled: (enabled: boolean) => void;
  onSetNetworkRoomId: (roomId: string) => void;
  /** Live AI Network state, for the shared status UI in the Network tab — its networkAvailable/networkSource already account for whether a collab room is joined. */
  net: UseLlmNetResult;
  onClose: () => void;
  initialTab?: SettingsTab;
};

// Tab order = focus/arrow-navigation order. "display" is the default so the
// modal opens on the lighter, more commonly touched preferences rather than
// the dense AI-provider config.
const TABS: { id: SettingsTab; labelKey: TranslationKey }[] = [
  { id: "display", labelKey: "settings.tab.display" },
  { id: "connection", labelKey: "settings.tab.connection" },
  { id: "network", labelKey: "settings.tab.network" },
  { id: "tasks", labelKey: "settings.tab.tasks" },
];

// One unified, tabbed Settings surface, opened by the single toolbar gear.
// Shows exactly one section at a time (Display / Connection / Network /
// Tasks) to keep the amount of information on screen low. Owns the dialog
// chrome (overlay, header, focus trap via useModalA11y); the per-tab bodies
// are chrome-less panels. The former single "AI" tab (LlmSettingsPanel) was
// split into these three focused tabs — Connection (providers/presets),
// Network (AI Network room + consumer/provider roles), and Tasks (use-case
// -> model assignment).
export function SettingsModal(props: SettingsModalProps) {
  const {
    onClose,
    initialTab = "display",
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
    onSetReasoningEffort,
    onSetConnection,
    onSetProviderModeEnabled,
    onSetNetworkRoomId,
    net,
  } = props;
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({
    display: null,
    connection: null,
    network: null,
    tasks: null,
  });
  // Default useModalA11y focus target is the first focusable element, which
  // here is the header's close (X) button — opening the dialog with focus
  // (and a stray Enter) on "close" is surprising. Land on the active tab
  // instead, matching the WAI-ARIA dialog pattern of focusing something
  // meaningful inside the content.
  const modalRef = useModalA11y(onClose, {
    initialFocus: () => tabRefs.current[activeTab],
  });
  const overlayDismiss = useOverlayDismiss(onClose);

  // Arrow keys move between tabs and activate on arrival (automatic
  // activation — switching a tab is cheap and side-effect-free here), matching
  // the WAI-ARIA tabs pattern. Home/End jump to the ends.
  function onTabKeyDown(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) {
    const idx = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const next = TABS[nextIdx].id;
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div class="settings-overlay" {...overlayDismiss}>
      <div
        class="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="settings-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button type="button" class="icon-btn" onClick={onClose} aria-label={t("appSettings.close")}>
            <Icon name="close" />
          </button>
        </div>

        <div class="settings-tabs" role="tablist" aria-label={t("settings.title")}>
          {TABS.map((tab) => {
            const selected = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls="settings-panel"
                class={`settings-tab ${selected ? "settings-tab--active" : ""}`}
                // Roving tabindex (WAI-ARIA tabs pattern): only the active
                // tab is a Tab stop. Inactive tabs are still reachable via
                // the arrow-key handler below, so Tab moves straight from
                // the active tab into its panel instead of stopping on both.
                tabIndex={selected ? 0 : -1}
                ref={(el) => {
                  tabRefs.current[tab.id] = el as HTMLButtonElement | null;
                }}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={onTabKeyDown}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* One panel element whose contents swap with the active tab, so each
            tab's aria-controls always resolves and only one section renders. */}
        <div
          class="settings-panel"
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {activeTab === "display" && <AppSettingsPanel onClose={onClose} />}
          {activeTab === "connection" && (
            <LlmConnectionPanel
              settings={settings}
              shared={shared}
              onAddProvider={onAddProvider}
              onUpdateProvider={onUpdateProvider}
              onRemoveProvider={onRemoveProvider}
              onAddPreset={onAddPreset}
              onUpdatePreset={onUpdatePreset}
              onRemovePreset={onRemovePreset}
            />
          )}
          {activeTab === "network" && (
            <LlmNetworkPanel
              settings={settings}
              shared={shared}
              onSetConnection={onSetConnection}
              onSetProviderModeEnabled={onSetProviderModeEnabled}
              onSetNetworkRoomId={onSetNetworkRoomId}
              net={net}
            />
          )}
          {activeTab === "tasks" && (
            <LlmTasksPanel
              settings={settings}
              shared={shared}
              onSetDefaultPresetId={onSetDefaultPresetId}
              onSetEmbeddingModel={onSetEmbeddingModel}
              onSetReasoningEffort={onSetReasoningEffort}
              networkConnected={net.networkAvailable}
            />
          )}
        </div>
      </div>
    </div>
  );
}
