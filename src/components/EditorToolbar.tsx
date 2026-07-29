import type { JSX } from "preact";
import type { NoteMeta } from "../lib/mistlib";
import type { CollabStatus, CollabUser, PeerInfo } from "../lib/collab";
import type { RoomSource } from "../hooks/useCollab";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { CollabButton } from "./CollabButton";
import { Icon } from "./Icon";

export function EditorToolbar(props: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeMeta: NoteMeta | undefined;
  status: string;
  onToggleFavorite: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  activeId: string;
  collabStatus: CollabStatus;
  collabRoomId: string | null;
  collabRoomSource: RoomSource;
  collabPeers: PeerInfo[];
  collabUser: CollabUser;
  onCollabShare: () => void;
  onCollabLeave: () => void;
  onCollabJoinById: (roomId: string) => Promise<string | null>;
  onCollabUpdateUser: (user: CollabUser) => void;
  onOpenSettings: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  reviewOpen: boolean;
  onToggleReview: () => void;
}) {
  const {
    sidebarOpen,
    onToggleSidebar,
    activeMeta,
    status,
    onToggleFavorite,
    activeId,
    collabStatus,
    collabRoomId,
    collabRoomSource,
    collabPeers,
    collabUser,
    onCollabShare,
    onCollabLeave,
    onCollabJoinById,
    onCollabUpdateUser,
    onOpenSettings,
    chatOpen,
    onToggleChat,
    reviewOpen,
    onToggleReview,
  } = props;
  const t = useT();
  const { resolvedTheme, setTheme } = useAppSettings();

  const isSaving = status === "saving" || status === "loading";
  const isSaved = status === "saved";
  const isError = status.startsWith("save-error:") || status.startsWith("load-error:");

  let displayStatus = "";
  if (status === "saving") displayStatus = t("editorToolbar.status.saving");
  else if (status === "loading") displayStatus = t("editorToolbar.status.loading");
  else if (status.startsWith("save-error:")) {
    displayStatus = t("editorToolbar.status.saveError", { detail: status.slice("save-error:".length) });
  } else if (status.startsWith("load-error:")) {
    displayStatus = t("editorToolbar.status.loadError", { detail: status.slice("load-error:".length) });
  }

  return (
    <div class="toolbar">
      <button
        type="button"
        class="icon-btn"
        onClick={onToggleSidebar}
        title={sidebarOpen ? t("editorToolbar.toggleSidebar.hide") : t("editorToolbar.toggleSidebar.show")}
        aria-label={t("editorToolbar.toggleSidebarAriaLabel")}
      >
        <Icon name="menu" />
      </button>
      <div class="spacer" />
      <CollabButton
        status={collabStatus}
        roomId={collabRoomId}
        roomSource={collabRoomSource}
        peers={collabPeers}
        user={collabUser}
        activeNoteId={activeId}
        onShare={onCollabShare}
        onLeave={onCollabLeave}
        onJoinById={onCollabJoinById}
        onUpdateUser={onCollabUpdateUser}
      />
      <button
        type="button"
        class={`icon-btn ${activeMeta?.favorite ? "icon-btn--active" : ""}`}
        onClick={(e) => onToggleFavorite(activeId, e)}
        aria-label={t("editorToolbar.favoriteToggle")}
        title={t("editorToolbar.favoriteToggle")}
      >
        <Icon name={activeMeta?.favorite ? "star" : "star-outline"} />
      </button>
      {/* Single live region so screen readers announce save-state changes —
          a nested role="alert" would double-announce the error. */}
      <span role="status" aria-live="polite">
        {isSaving && <span class="status">{displayStatus}</span>}
        {isError && <span class="status status--error">{displayStatus}</span>}
        {isSaved && (
          <span class="status status--ok" title={t("editorToolbar.status.saved")} aria-label={t("editorToolbar.status.saved")}>
            <Icon name="check" size={15} />
          </span>
        )}
      </span>
      <div class="toolbar-divider" />
      <button
        type="button"
        class={`icon-btn ${chatOpen ? "icon-btn--active" : ""}`}
        onClick={onToggleChat}
        title={t("editorToolbar.chatTitle")}
        aria-label={t("editorToolbar.chatTitle")}
        aria-pressed={chatOpen}
      >
        <Icon name="chat" />
      </button>
      <button
        type="button"
        class={`icon-btn ${reviewOpen ? "icon-btn--active" : ""}`}
        onClick={onToggleReview}
        title={t("editorToolbar.reviewTitle")}
        aria-label={t("editorToolbar.reviewTitle")}
        aria-pressed={reviewOpen}
      >
        <Icon name="rubric" />
      </button>
      <button
        type="button"
        class="icon-btn"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        title={resolvedTheme === "dark" ? t("editorToolbar.themeToggle.toLight") : t("editorToolbar.themeToggle.toDark")}
        aria-label={resolvedTheme === "dark" ? t("editorToolbar.themeToggle.toLight") : t("editorToolbar.themeToggle.toDark")}
      >
        <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
      </button>
      <button
        type="button"
        class="icon-btn"
        onClick={onOpenSettings}
        title={t("settings.title")}
        aria-label={t("settings.title")}
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
