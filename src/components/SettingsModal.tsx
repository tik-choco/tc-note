import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import type { TranslationKey } from "../lib/i18n";
import { Icon } from "./Icon";
import { AppSettingsPanel } from "./AppSettingsPanel";
import { LlmSettingsPanel, type LlmSettingsPanelProps } from "./LlmSettingsPanel";

export type SettingsTab = "display" | "ai";

// Tab order = focus/arrow-navigation order. "display" is the default so the
// modal opens on the lighter, more commonly touched preferences rather than
// the dense AI-provider config.
const TABS: { id: SettingsTab; labelKey: TranslationKey }[] = [
  { id: "display", labelKey: "settings.tab.display" },
  { id: "ai", labelKey: "settings.tab.ai" },
];

// One unified, tabbed Settings surface, opened by the single toolbar gear.
// Shows exactly one section at a time (Display or AI) to keep the amount of
// information on screen low. Owns the dialog chrome (overlay, header, focus
// trap via useModalA11y); the per-tab bodies are chrome-less panels.
export function SettingsModal(props: LlmSettingsPanelProps & {
  onClose: () => void;
  initialTab?: SettingsTab;
}) {
  const { onClose, initialTab = "display", ...llmPanelProps } = props;
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({ display: null, ai: null });
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
          {activeTab === "display" ? <AppSettingsPanel onClose={onClose} /> : <LlmSettingsPanel {...llmPanelProps} />}
        </div>
      </div>
    </div>
  );
}
