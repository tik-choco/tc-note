import { useEffect, useRef, useState } from "preact/hooks";
import type { CollabStatus, CollabUser, PeerInfo } from "../lib/collab";
import type { RoomSource } from "../hooks/useCollab";
import { withNoteParam } from "../hooks/useNoteUrlSync";
import { useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

// Carries both `room=` and `note=` so the joiner can open/create the exact
// note being shared before the room's `meta` noteId even syncs in (see
// useCollab's adoption path, which handles the case where they arrive some
// other way — pasted room id, no note param, etc).
export function inviteUrl(roomId: string, noteId: string | null): string {
  const url = new URL(withNoteParam(noteId));
  url.searchParams.set("room", roomId);
  return url.toString();
}

// Share/collaborate control: click opens a popover with an explicit "start
// sharing" button (or, once in a room, the copyable invite link), connection
// state, connected peers, a "join by room ID" field, and the local user's
// name/color settings. Doubles as the presence entry point in the toolbar.
export function CollabButton(props: {
  status: CollabStatus;
  roomId: string | null;
  roomSource: RoomSource;
  peers: PeerInfo[];
  user: CollabUser;
  /** The locally-open note's id, included in the invite link as `note=`. */
  activeNoteId: string;
  onShare: () => void;
  onLeave: () => void;
  onJoinById: (roomId: string) => Promise<string | null>;
  onUpdateUser: (user: CollabUser) => void;
}) {
  const { status, roomId, roomSource, peers, user, activeNoteId, onShare, onLeave, onJoinById, onUpdateUser } =
    props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.name);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  usePopoverDismiss(popoverRef, open, () => setOpen(false));

  // Keep the name field in sync if the user identity changes elsewhere
  // (e.g. loaded fresh from localStorage) while the popover is closed.
  useEffect(() => {
    if (!open) setNameDraft(user.name);
  }, [open, user.name]);

  // Only toggles the popover — starting a room is an explicit button inside
  // it, so a stray click on the icon can't silently begin sharing the note.
  function handleClick() {
    setOpen((v) => !v);
  }

  async function handleCopy() {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(roomId, activeNoteId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — the link is still selectable in the input
    }
  }

  async function handleJoinById(e: Event) {
    e.preventDefault();
    if (!joinInput.trim() || joining) return;
    setJoining(true);
    setJoinError(null);
    const error = await onJoinById(joinInput);
    setJoining(false);
    if (error) {
      setJoinError(error);
    } else {
      setJoinInput("");
    }
  }

  function commitName() {
    const name = nameDraft.trim();
    if (name && name !== user.name) onUpdateUser({ ...user, name });
    else setNameDraft(user.name);
  }

  return (
    <div class="collab" ref={popoverRef}>
      <button
        type="button"
        class={`icon-btn collab-trigger collab-trigger--${status}`}
        onClick={handleClick}
        title={t(`collabButton.status.${status}`)}
        aria-label={t(`collabButton.status.${status}`)}
      >
        <Icon name={status === "connected" ? "people" : "share"} />
      </button>
      {peers.length > 0 && (
        <div class="collab-avatars" aria-label={t("collabButton.peersConnected", { count: peers.length })}>
          {peers.slice(0, 4).map((p) => (
            <span key={p.clientId} class="collab-avatar" style={{ background: p.color }} title={p.name}>
              {p.name.slice(0, 1)}
            </span>
          ))}
          {peers.length > 4 && (
            <span
              class="collab-avatar collab-avatar--overflow"
              title={t("collabButton.overflowPeers", { count: peers.length - 4 })}
            >
              +{peers.length - 4}
            </span>
          )}
        </div>
      )}
      {open && (
        <div class="collab-popover">
          <div class={`collab-badge collab-badge--${status}`}>
            <span class="collab-badge-dot" aria-hidden="true" />
            {t(`collabButton.status.${status}`)}
          </div>
          {roomId && roomSource === "folder" && (
            <div class="collab-room-source">{t("collabButton.folderShared")}</div>
          )}

          {roomId && (
            <>
              <div class="collab-invite-row">
                <input
                  class="collab-invite-input"
                  readOnly
                  value={inviteUrl(roomId, activeNoteId)}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button type="button" class="icon-btn" onClick={handleCopy} title={t("collabButton.copyLink")}>
                  <Icon name={copied ? "check" : "content-copy"} size={17} />
                </button>
              </div>
              <ul class="collab-peer-list">
                {peers.length === 0 && <li class="collab-peer-empty">{t("collabButton.noPeersYet")}</li>}
                {peers.map((p) => (
                  <li key={p.clientId}>
                    <span class="collab-dot" style={{ background: p.color }} />
                    {p.name}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                class="collab-leave"
                onClick={() => {
                  if (window.confirm(t("collabButton.leaveConfirm"))) onLeave();
                }}
              >
                {t("collabButton.leaveButton")}
              </button>
            </>
          )}

          {!roomId && (
            <>
              <p class="collab-hint">{t("collabButton.explainNote")}</p>
              <button type="button" class="collab-start" onClick={onShare}>
                {t("collab.startSharing")}
              </button>
            </>
          )}
          {!roomId && (
            <form class="collab-join-row" onSubmit={handleJoinById}>
              <input
                class="collab-invite-input"
                placeholder={t("collabButton.joinPlaceholder")}
                value={joinInput}
                onInput={(e) => {
                  setJoinInput((e.target as HTMLInputElement).value);
                  setJoinError(null);
                }}
              />
              <button
                type="submit"
                class="icon-btn"
                disabled={!joinInput.trim() || joining}
                title={t("collabButton.joinSubmit")}
              >
                {joining ? <span class="spinner" /> : <Icon name="arrow-forward" size={17} />}
              </button>
            </form>
          )}
          {joinError && <div class="collab-error">{joinError}</div>}

          <div class="collab-settings">
            <label class="collab-settings-row">
              <span>{t("collabButton.displayName")}</span>
              <input
                class="collab-invite-input"
                value={nameDraft}
                onInput={(e) => setNameDraft((e.target as HTMLInputElement).value)}
                onBlur={commitName}
                maxLength={40}
              />
            </label>
            <label class="collab-settings-row">
              <span>{t("collabButton.cursorColor")}</span>
              <input
                class="collab-color-input"
                type="color"
                value={user.color}
                onInput={(e) => onUpdateUser({ ...user, color: (e.target as HTMLInputElement).value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
