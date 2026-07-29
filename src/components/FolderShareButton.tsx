import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { Folder } from "../lib/mistlib";
import { isValidRoomId, type CollabStatus } from "../lib/collab";
import { useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

// Per-folder share settings, opened from the small 🔗 icon in the folder
// row: generate a new shared room, join an existing one by pasting its id,
// or turn sharing off. Notes filed into a shared folder auto-join its room
// (see useCollab's folder-driven effect) — this is where that room id is
// assigned.
export function FolderShareButton(props: {
  folder: Folder;
  /** `isNew` is true only for the "generate new room" action — lets the
   * caller seed the room immediately rather than wait for the empty-room
   * fallback (see useCollab's performJoin). */
  onSetRoom: (folderId: string, roomId: string | null, isNew: boolean) => void;
  /** The collab session's live status, but only when this folder's room is
   * the one actually joined right now (see Sidebar's collabActiveRoomId
   * check) — null if this folder has a room id but isn't the active join
   * (e.g. a different note/folder is open), so its real connection state is
   * unknown rather than merely "not connected". */
  liveStatus: CollabStatus | null;
}) {
  const { folder, onSetRoom, liveStatus } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  usePopoverDismiss(popoverRef, open, () => setOpen(false));

  function toggleOpen(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setError(null);
    // The popover renders position:fixed (the sidebar's overflow containers
    // would clip an absolute one), so anchor it to the trigger's viewport
    // rect, clamped to the left screen edge.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 240;
      setPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      });
    }
    setOpen((v) => !v);
  }

  function handleGenerate(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onSetRoom(folder.id, crypto.randomUUID(), true);
  }

  function handleJoinExisting(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    const id = joinInput.trim();
    if (!isValidRoomId(id)) {
      setError(t("folderShare.invalidRoomId"));
      return;
    }
    onSetRoom(folder.id, id, false);
    setJoinInput("");
    setError(null);
  }

  function handleDisable(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (window.confirm(t("folderShare.disableConfirm"))) onSetRoom(folder.id, null, false);
  }

  async function handleCopy(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!folder.roomId) return;
    try {
      await navigator.clipboard.writeText(folder.roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — the room id is still selectable in the input
    }
  }

  return (
    <div class="folder-share" ref={popoverRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        class={`icon-btn folder-share-trigger ${folder.roomId ? "folder-share-trigger--active" : ""} ${
          liveStatus === "connected" ? "folder-share-trigger--live" : ""
        }`}
        onClick={toggleOpen}
        ref={triggerRef}
        title={folder.roomId ? t("folderShare.titleActive") : t("folderShare.titleInactive")}
        aria-label={t("folderShare.ariaLabel")}
      >
        <Icon name={liveStatus === "connected" ? "people" : "share"} />
      </button>
      {open && pos && (
        <div class="folder-share-popover" style={{ top: `${pos.top}px`, left: `${pos.left}px` }}>
          {folder.roomId ? (
            <>
              <div class={`collab-badge collab-badge--${liveStatus ?? "idle"}`}>
                <span class="collab-badge-dot" aria-hidden="true" />
                {t(`folderShare.status.${liveStatus ?? "idle"}`)}
              </div>
              <p class="collab-hint">{t("folderShare.explainShared")}</p>
              <div class="collab-invite-row">
                <input
                  class="collab-invite-input"
                  readOnly
                  value={folder.roomId}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button type="button" class="icon-btn" onClick={handleCopy} title={t("folderShare.copyRoomId")}>
                  <Icon name={copied ? "check" : "content-copy"} size={17} />
                </button>
              </div>
              <button
                type="button"
                class="collab-leave"
                onClick={handleDisable}
                disabled={liveStatus === "connecting"}
              >
                {t("folderShare.disable")}
              </button>
            </>
          ) : (
            <>
              <p class="collab-hint">{t("folderShare.explainIdle")}</p>
              <button
                type="button"
                class="icon-btn icon-btn--accent folder-share-generate"
                onClick={handleGenerate}
                disabled={liveStatus === "connecting"}
              >
                {t("folderShare.generateNew")}
              </button>
              <form class="collab-join-row" onSubmit={handleJoinExisting}>
                <input
                  class="collab-invite-input"
                  placeholder={t("folderShare.joinPlaceholder")}
                  value={joinInput}
                  onInput={(e) => setJoinInput((e.target as HTMLInputElement).value)}
                />
                <button
                  type="submit"
                  class="icon-btn"
                  disabled={!joinInput.trim() || liveStatus === "connecting"}
                  title={t("folderShare.joinSubmit")}
                >
                  {liveStatus === "connecting" ? <span class="spinner" /> : <Icon name="arrow-forward" size={17} />}
                </button>
              </form>
            </>
          )}
          {error && <div class="collab-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
