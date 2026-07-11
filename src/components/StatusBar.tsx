import type { NoteMeta } from "../lib/mistlib";
import type { PeerInfo } from "../lib/collab";
import { formatRelativeTime, formatTime } from "../lib/util";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { Icon } from "./Icon";

export function StatusBar(props: {
  activeMeta: NoteMeta | undefined;
  markdownChars: number;
  collabPeers?: PeerInfo[];
  onOpenShortcuts?: () => void;
}) {
  const { activeMeta, markdownChars, collabPeers = [], onOpenShortcuts } = props;
  const t = useT();
  const { language } = useAppSettings();
  return (
    <div class="status-bar">
      <span title={activeMeta ? formatTime(activeMeta.updatedAt, language) : undefined}>
        {activeMeta ? t("statusBar.updated", { time: formatRelativeTime(activeMeta.updatedAt, language) }) : t("statusBar.unsaved")}
      </span>
      <span>{t("statusBar.markdownChars", { count: markdownChars })}</span>
      {collabPeers.length > 0 && (
        <span class="status-bar-peers" title={collabPeers.map((p) => p.name).join(", ")}>
          {collabPeers.map((p) => (
            <span key={p.clientId} class="collab-dot" style={{ background: p.color }} />
          ))}
          {t("statusBar.peersEditing", { count: collabPeers.length })}
        </span>
      )}
      {onOpenShortcuts && (
        <button
          type="button"
          class="status-bar-shortcuts-btn"
          onClick={onOpenShortcuts}
          title={t("shortcutsModal.openButton")}
          aria-label={t("shortcutsModal.openButton")}
        >
          <Icon name="keyboard" size={14} />
        </button>
      )}
    </div>
  );
}
