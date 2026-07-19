import { MESSAGES_EN, MESSAGES_JA } from "@tik-choco/mistai";
import { ConsumerStatusIndicator, ProviderStatusPanel } from "@tik-choco/mistai/preact";
import type { LlmConnection, LlmSettings } from "../lib/llmSettings";
import type { SharedLlmConfigV1 } from "../lib/llmConfig";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { useDraftField } from "../hooks/useDraftField";
import type { UseLlmNetResult } from "../hooks/useLlmNet";
import { Icon } from "./Icon";

export type LlmNetworkPanelProps = {
  settings: LlmSettings;
  /** The shared, co-owned tc-shared-llm-config-v1 config (providers/presets/defaultPresetId/network.roomId). */
  shared: SharedLlmConfigV1;
  onSetConnection: (connection: LlmConnection) => void;
  onSetProviderModeEnabled: (enabled: boolean) => void;
  onSetNetworkRoomId: (roomId: string) => void;
  /** Live AI Network state, for the shared status UI below — its networkAvailable/networkSource already account for whether a collab room is joined. */
  net: UseLlmNetResult;
};

// "Network" tab body inside SettingsModal: the AI Network room id, and two
// role cards (Consumer / Provider) mirroring tc-translate's
// settings-role-card pattern — a checkbox+title header that expands into the
// shared @tik-choco/mistai status UI (ConsumerStatusIndicator /
// ProviderStatusPanel) only while that role is enabled. No dialog chrome of
// its own; the surrounding modal owns the overlay, header, and tab chrome.
export function LlmNetworkPanel(props: LlmNetworkPanelProps) {
  const { settings, shared, onSetConnection, onSetProviderModeEnabled, onSetNetworkRoomId, net } = props;

  const t = useT();
  const { language } = useAppSettings();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;

  // Commit-on-blur/Enter (llm-settings-common-v1.md §3.3), not on every
  // keystroke: `network.roomId` lives in the shared, co-owned
  // tc-shared-llm-config-v1 record, so every keystroke would otherwise write
  // through to every same-origin tik-choco app immediately.
  const roomIdField = useDraftField(shared.network.roomId, onSetNetworkRoomId);

  return (
    <div class="llm-network-panel">
      <div class="llm-settings-hint">{t("llmSettings.networkTransportNote")}</div>

      <label class="llm-settings-row">
        <span>{t("llmSettings.networkRoomIdLabel")}</span>
        <input
          placeholder={t("llmSettings.networkRoomIdPlaceholder")}
          value={roomIdField.draft}
          onInput={(e) => roomIdField.onInput((e.target as HTMLInputElement).value)}
          onFocus={roomIdField.onFocus}
          onBlur={roomIdField.onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      {!shared.network.roomId.trim() && !net.networkAvailable && (
        <div class="llm-settings-hint">{t("llmSettings.networkRoomIdHint")}</div>
      )}

      <div class="llm-network-role-group">
        <div class="llm-network-role-card">
          <label class="llm-network-role-head">
            <input
              type="checkbox"
              checked={settings.connection === "network"}
              onChange={(e) =>
                onSetConnection((e.target as HTMLInputElement).checked ? "network" : "api")
              }
            />
            <span class="llm-network-role-title">
              <Icon name="link" size={15} />
              {t("llmSettings.connection.network")}
            </span>
          </label>
          {settings.connection === "network" && (
            <div class="llm-network-role-body">
              <ConsumerStatusIndicator status={net.consumerStatus} variant="detailed" messages={mistaiMessages} />
              {net.dedicatedRoomStatus === "error" && !net.networkAvailable && (
                <div class="llm-settings-error">{t("llmSettings.networkRoomIdConnectError")}</div>
              )}
              <p class="llm-network-role-desc">{t("llmSettings.connection.networkHint")}</p>
            </div>
          )}
        </div>

        <div class="llm-network-role-card">
          <label class="llm-network-role-head">
            <input
              type="checkbox"
              checked={settings.providerModeEnabled}
              onChange={(e) => onSetProviderModeEnabled((e.target as HTMLInputElement).checked)}
            />
            <span class="llm-network-role-title">
              <Icon name="share" size={15} />
              {t("llmSettings.providerModeLabel")}
            </span>
          </label>
          {settings.providerModeEnabled && (
            <div class="llm-network-role-body">
              {net.apiReady ? (
                <ProviderStatusPanel
                  status={net.providerModeActive && net.networkAvailable ? "connected" : "idle"}
                  peers={net.consumerPeers.map((peer) => ({ ...peer, isConsumer: true }))}
                  consumerCount={net.consumerPeers.length}
                  logs={net.providerLogs}
                  messages={mistaiMessages}
                />
              ) : (
                <div class="llm-settings-error">{t("llmSettings.providerModeNeedsProvider")}</div>
              )}
              <p class="llm-network-role-desc">{t("llmSettings.providerModeHint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
