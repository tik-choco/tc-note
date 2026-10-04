import { useState } from "preact/hooks";
import { LlmSettings, type LlmSettingsLocalAdapter } from "@tik-choco/mistai/preact";
import "@tik-choco/mistai/ui.css";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { aiSettingsMessages, aiSettingsLocale } from "../lib/aiSettingsMessages";
import { AppSettingsPanel } from "./AppSettingsPanel";
import { Icon } from "./Icon";

export type SettingsTab = "display" | "connection" | "tasks" | "sharing";
export type SettingsModalProps = {
  localSettings: LlmSettingsLocalAdapter;
  showToast: (message: string) => void;
  onClose: () => void;
  initialTab?: SettingsTab;
};

export function SettingsModal(props: SettingsModalProps) {
  const t = useT();
  const { language } = useAppSettings();
  const locale = aiSettingsLocale(language);
  const copy = aiSettingsMessages[locale];
  const [display, setDisplay] = useState(props.initialTab === undefined || props.initialTab === "display");
  const modalRef = useModalA11y(props.onClose, {
    initialFocus: () => document.querySelector<HTMLButtonElement>(".settings-tabs [aria-selected=true]"),
    portalSelector: ".mistai-surface:not(.mistai-settings):not([inert])",
  });
  const overlayDismiss = useOverlayDismiss(props.onClose);
  return (
    <div class="settings-overlay" {...overlayDismiss}>
      <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={modalRef}>
        <div class="settings-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button type="button" class="icon-btn" onClick={props.onClose} aria-label={t("appSettings.close")}><Icon name="close" /></button>
        </div>
        <div class="settings-tabs" role="tablist" aria-label={t("settings.title")}>
          <button type="button" role="tab" aria-selected={display} class={`settings-tab ${display ? "settings-tab--active" : ""}`} onClick={() => setDisplay(true)}>{t("settings.tab.display")}</button>
          <button type="button" role="tab" aria-selected={!display} class={`settings-tab ${!display ? "settings-tab--active" : ""}`} onClick={() => setDisplay(false)}>AI</button>
        </div>
        <div class="settings-panel" role="tabpanel">
          {display ? <AppSettingsPanel onClose={props.onClose} showToast={props.showToast} /> : <LlmSettings
            tasks={[
              { id: "default", label: copy.defaultLabel, tip: copy.defaultTip, reasoning: true },
              { id: "embedding", label: copy.embeddingLabel, tip: copy.embeddingTip, reasoning: true },
            ]}
            localSettings={props.localSettings} locale={locale}
            initialTab={props.initialTab === "display" ? "connection" : props.initialTab}
          />}
        </div>
      </div>
    </div>
  );
}
