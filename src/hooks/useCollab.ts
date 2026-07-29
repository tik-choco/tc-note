import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CollabSession,
  clampUserName,
  deriveNoteRoomId,
  isValidRoomId,
  normalizeColor,
  type CollabStatus,
  type CollabUser,
  type PeerInfo,
} from "../lib/collab";
import { reconcileBlockIds } from "../lib/blockDiff";
import { joinBlocks } from "../lib/blocks";
import { loadAppSettings } from "../lib/appSettings";
import { translate } from "../lib/i18n";
import { useT } from "./useAppSettings";

const USER_KEY = "tc-note:collab-user";
const PALETTE = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];
// How long a freshly-joined *existing* room (join-by-id, ?room= URL, folder
// auto-join) waits for sync to pull in any content a peer already has
// before falling back to seeding with the locally-open note. Long enough
// for a sync step1/step2 round trip over mistlib in practice; this is a
// heuristic since y-protocols doesn't expose a "sync settled" event to
// consumers — see the seed-fallback comment in performJoin for the
// reasoning this trades off.
const SEED_FALLBACK_DELAY_MS = 500;

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function loadOrCreateUser(): CollabUser {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollabUser>;
      if (typeof parsed.name === "string" && typeof parsed.color === "string") {
        return { name: clampUserName(parsed.name), color: normalizeColor(parsed.color) };
      }
    }
  } catch {
    // fall through to generating a fresh identity
  }
  const n = Math.floor(Math.random() * 900 + 100);
  const name = translate(loadAppSettings().language, "useCollab.guestName", { n });
  const user: CollabUser = { name, color: colorFor(name) };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // localStorage unavailable (private mode etc.) — identity just won't persist
  }
  return user;
}

/**
 * When a remote doc update rebuilds every block, keep the block the local user
 * is *actively editing* at its in-progress value instead of the incoming
 * remote one, so a peer's edit elsewhere can't stomp the caret/keystrokes in
 * the block under the cursor.
 *
 * The active block is matched by its stable id, not its array index — a peer's
 * concurrent insert/delete may have shifted its position between `localIds`
 * (the ids parallel to what's on screen) and `remoteIds` (the order the update
 * carries). The local value is only substituted when it actually diverges from
 * what was last synced for that slot (`lastSyncedValues`): an *untouched*
 * active block should still pick up remote edits normally, and a divergence is
 * what tells "user has unsynced keystrokes here" apart from "nothing local to
 * protect". Returns a fresh array only when it substitutes; otherwise the
 * input `remoteBlocks` is returned unchanged.
 *
 * Pure and exported for direct testing — the hook can't be rendered under this
 * project's DOM-less test setup, so this is where the id-based preservation
 * contract is pinned down.
 */
export function preserveActiveEdit(
  remoteBlocks: string[],
  remoteIds: string[],
  activeIndex: number | null,
  localIds: string[],
  localValues: string[],
  lastSyncedValues: string[],
): string[] {
  if (activeIndex === null || activeIndex >= localIds.length) return remoteBlocks;
  const activeId = localIds[activeIndex];
  const newIdx = remoteIds.indexOf(activeId);
  const localValue = localValues[activeIndex];
  const lastSynced = lastSyncedValues[activeIndex];
  if (newIdx === -1 || localValue === undefined || localValue === lastSynced) return remoteBlocks;
  const next = remoteBlocks.slice();
  next[newIdx] = localValue;
  return next;
}

export interface UseCollabParams {
  title: string;
  blocksSnapshot: string[];
  setTitle: (t: string) => void;
  setBlocksSnapshot: (b: string[]) => void;
  /** Kept in lockstep with blocksSnapshot when applying remote doc state — see applyDocToLocalState. */
  setContent: (c: string) => void;
  activeBlockIndex: number | null;
  /** The locally-open note's id — written into the room's doc when seeding, so peers can adopt it. */
  noteId: string;
  /** Opens (or creates) the note with the given id as the active note — see useNoteSession's openOrCreateNote. */
  onAdoptNoteId?: (id: string) => Promise<void> | void;
  /**
   * The active note's folder's shared room id — a *base* id the per-note room
   * is derived from (see deriveNoteRoomId), not a room joined as-is. Null if
   * the folder isn't shared, or the note is unfiled.
   */
  folderRoomId?: string | null;
  /** Called when a non-seeding join's first synced content actually differs from what was open locally. */
  onRoomContentReplaced?: () => void;
}

export type RoomSource = "folder" | "manual" | null;

/**
 * Which room the currently-open note belongs in, given what the user has
 * explicitly joined (`manualRoomByNote`, keyed by note id) and the room its
 * folder derives for it (`folderNoteRoomId`, already per-note — see
 * deriveNoteRoomId).
 *
 * Pure and exported for direct testing: the hook can't be rendered under this
 * project's DOM-less test setup, and this is the rule that decides whether
 * switching notes keeps, swaps, or drops the live session. A manual join wins
 * for the note it was made on and *only* that note — a stale entry for some
 * other note must never leak into the note now on screen, which is the bug
 * that made every note look collaborative once one had been shared.
 */
export function resolveTargetRoom(
  noteId: string,
  folderNoteRoomId: string | null,
  manualRoomByNote: ReadonlyMap<string, string>,
): { roomId: string | null; source: RoomSource } {
  const manual = manualRoomByNote.get(noteId);
  if (manual) return { roomId: manual, source: "manual" };
  if (folderNoteRoomId) return { roomId: folderNoteRoomId, source: "folder" };
  return { roomId: null, source: null };
}

// Binds the app's block/title state to a CollabSession's Yjs doc. Local
// edits are mirrored into the doc (broadcast to peers) at per-block
// granularity — see blockDiff.ts — so two peers editing different blocks
// don't clobber each other. Remote doc changes are mirrored back into local
// state; `lastAppliedBlocksRef`/`lastAppliedTitleRef` break the loop that
// would otherwise form between those two directions — the local-mirror
// effect below skips writing back to Yjs exactly when `blocksSnapshot` is
// the very array reference (and `title` the exact value) it just applied
// from a remote update, however many remote updates land between renders.
//
// Room membership is *per note*, and re-derived from scratch every time the
// active note changes — see resolveTargetRoom. There are two sources:
//   - explicit user action (share button, "join by room ID", a `?room=` URL),
//     remembered per note id in `manualRoomsRef`, and
//   - the active note's folder, via a room derived per-note from the folder's
//     base id (`folderRoomId` -> deriveNoteRoomId).
// A manual room wins for the note it was performed on. Neither carries over
// to the next note the user opens: switching notes leaves the previous note's
// room and joins whatever the new note resolves to (often nothing), so
// sharing one note never silently puts every other note into that room.
export function useCollab(params: UseCollabParams) {
  const t = useT();
  const {
    title,
    blocksSnapshot,
    setTitle,
    setBlocksSnapshot,
    setContent,
    activeBlockIndex,
    noteId,
    onAdoptNoteId,
    folderRoomId = null,
    onRoomContentReplaced,
  } = params;

  const [status, setStatus] = useState<CollabStatus>("idle");
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomSource, setRoomSource] = useState<RoomSource>(null);
  const [user, setUser] = useState<CollabUser>(() => loadOrCreateUser());
  // The currently-live CollabSession, surfaced as state (not just the ref
  // below) so consumers like useLlmNet can re-bind their LLM handlers when
  // the session is replaced on a room switch.
  const [session, setSession] = useState<CollabSession | null>(null);

  const sessionRef = useRef<CollabSession | null>(null);
  // Rooms the user explicitly joined (share button / join-by-id / `?room=`),
  // keyed by the note that was open at the time. Held in a ref because the
  // room-membership effect reads it while deciding what to join — but the
  // sidebar marks these notes as shared, so every write is mirrored into
  // `manualNoteIds` state via rememberManualRoom/forgetManualRoom.
  const manualRoomsRef = useRef<Map<string, string>>(new Map());
  // The keys of manualRoomsRef, as state. Sorted so an unchanged set produces
  // an equal array and the memo below doesn't hand consumers a new Set on
  // every unrelated render.
  const [manualNoteIds, setManualNoteIds] = useState<string[]>([]);

  function syncManualNoteIds(): void {
    setManualNoteIds(Array.from(manualRoomsRef.current.keys()).sort());
  }

  function rememberManualRoom(noteId: string, id: string): void {
    if (manualRoomsRef.current.get(noteId) === id) return;
    manualRoomsRef.current.set(noteId, id);
    syncManualNoteIds();
  }

  function forgetManualRoom(noteId: string): void {
    if (!manualRoomsRef.current.delete(noteId)) return;
    syncManualNoteIds();
  }
  // Mirrors `roomId` state for the room-membership effect and performJoin,
  // both of which run against whatever the latest join left behind rather
  // than the value captured in their render closure.
  const roomIdRef = useRef<string | null>(null);
  // Room ids assigned to a folder come from localStorage (see mistlib.ts),
  // outside this hook's control — validate before ever handing one to
  // performJoin/mistlib's joinRoom, same as pasted-in ids.
  const sanitizedFolderRoomId = folderRoomId && isValidRoomId(folderRoomId) ? folderRoomId : null;
  // The room the folder auto-join actually targets: per *note*, derived from
  // the folder's base id, so two notes in one shared folder don't end up
  // editing the same Y.Doc. See deriveNoteRoomId for why this derivation
  // exists and what it requires of peers.
  const folderNoteRoomId = sanitizedFolderRoomId ? deriveNoteRoomId(sanitizedFolderRoomId, noteId) : null;
  // Set right before assigning a *newly generated* room id to the active
  // note's folder (see markNextFolderJoinAsNew), holding that specific room
  // id — not a bare boolean — so the folder-driven auto-join effect below
  // only treats it as a room-creation flow if the id it's about to join is
  // the exact one that was just generated. A boolean here previously leaked
  // across unrelated folders: generating a room for folder A while viewing
  // a note in folder B left the flag pending, and later switching into an
  // already-shared folder C would consume it and seed C's populated room,
  // reintroducing the duplicate-block race this flag exists to prevent.
  // Cleared unconditionally on every folder join attempt (matched or not)
  // so it can never survive to affect a later, unrelated room. Holds the
  // folder's *base* id (what FolderShareButton generates), not the per-note
  // room derived from it — only the active note's derived room is seeded
  // here; the folder's other notes reach their own empty derived rooms via
  // performJoin's seed-fallback timer when they're first opened.
  const pendingSeedRoomIdRef = useRef<string | null>(null);
  // Mirrors `peers` state for use inside the seed-fallback setTimeout below,
  // which closes over values from whenever performJoin was called — the
  // `peers` state itself would be stale by the time the timer fires.
  const peersRef = useRef<PeerInfo[]>([]);
  // Captures the locally-open note right before a non-seeding join, so the
  // first doc change that join receives can be checked for whether it
  // actually replaced that content (vs. e.g. re-syncing the same content).
  const pendingOverwriteCheckRef = useRef<{ blocks: string[]; title: string } | null>(null);
  // Kept in sync with the `noteId`/`onAdoptNoteId` props on every render
  // (rather than read directly) because the closures below — applyDocToLocalState
  // and seedIfEmpty in particular — are captured once per join by
  // createSession/performJoin and would otherwise keep seeing whichever note
  // was active at join time.
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const onAdoptNoteIdRef = useRef(onAdoptNoteId);
  onAdoptNoteIdRef.current = onAdoptNoteId;
  // Same rationale as noteIdRef above, and the reason it exists: the closures
  // that consume these — applyDocToLocalState (via the session's onDocChange
  // callback) and seedIfEmpty (via the seed-fallback timer) — are captured
  // *once per join* by createSession/performJoin, so reading `activeBlockIndex`
  // / `blocksSnapshot` / `title` off the render scope would freeze them at
  // their join-time values for the whole life of the session. A remote update
  // that lands while the user is editing must see the *current* active block
  // and its *current* on-screen text, or the active-block guard below matches
  // the wrong block (typically null, since a join happens from an idle click)
  // and the incoming remote value stomps the user's in-progress keystrokes.
  const activeBlockIndexRef = useRef(activeBlockIndex);
  activeBlockIndexRef.current = activeBlockIndex;
  const blocksSnapshotRef = useRef(blocksSnapshot);
  blocksSnapshotRef.current = blocksSnapshot;
  const titleRef = useRef(title);
  titleRef.current = title;
  // Set alongside pendingOverwriteCheckRef for a *manual* non-seeding join
  // only (share/join-by-id/URL) — folder auto-joins intentionally always
  // target whichever note is locally active, so they never adopt a remote
  // note id. Checked and cleared on the first doc change the join receives.
  const pendingAdoptCheckRef = useRef(false);
  // The exact array/string this session last wrote into local state from a
  // remote doc change. Compared by reference for blocks (setBlocksSnapshot
  // is never called with a cloned array) so it survives any number of
  // remote applies landing before the next render.
  const lastAppliedBlocksRef = useRef<string[] | null>(null);
  const lastAppliedTitleRef = useRef<string | null>(null);
  // Stable per-block ids parallel to blocksSnapshot, and the values they
  // were last written with — the baseline the next diff is computed against.
  const idsRef = useRef<string[]>(blocksSnapshot.map(() => crypto.randomUUID()));
  const valuesRef = useRef<string[]>(blocksSnapshot);
  const [blockIds, setBlockIds] = useState<string[]>(idsRef.current);

  function applyDocToLocalState(session: CollabSession) {
    // Only checked once per manual non-seeding join, on whatever doc change
    // arrives first (normally the sync step2 that also carries the room's
    // content). If the room was seeded by a different note, switch the local
    // session to that note *instead of* pouring this content into whatever
    // was open locally — then re-run against the now-current local state
    // once the switch lands, since sync itself won't fire again on its own.
    if (pendingAdoptCheckRef.current) {
      pendingAdoptCheckRef.current = false;
      const remoteNoteId = session.meta.get("noteId");
      if (remoteNoteId && remoteNoteId !== noteIdRef.current) {
        console.debug("[collab] applyDocToLocalState: adopting remote note id", {
          from: noteIdRef.current,
          to: remoteNoteId,
        });
        pendingOverwriteCheckRef.current = null;
        // Re-key this session's manual room onto the note being adopted
        // *before* the switch lands, so the room-membership effect that the
        // note change triggers resolves to the room we're already in rather
        // than tearing it down as "a room belonging to some other note".
        const joinedRoom = roomIdRef.current;
        if (joinedRoom && manualRoomsRef.current.get(noteIdRef.current) === joinedRoom) {
          forgetManualRoom(noteIdRef.current);
          rememberManualRoom(remoteNoteId, joinedRoom);
        }
        const adopt = onAdoptNoteIdRef.current;
        if (adopt) {
          Promise.resolve(adopt(remoteNoteId)).then(() => {
            if (sessionRef.current === session) applyDocToLocalState(session);
          });
        }
        return;
      }
    }

    const ids = session.order.toArray();
    const values = ids.map((id) => session.blockContents.get(id) ?? "");
    let blocksToApply = values.length ? values : [""];
    const titleToApply = session.meta.get("title") ?? "";

    // A remote doc update rebuilds every block wholesale. If the local user
    // is mid-keystroke in one of them, blindly applying the remote value
    // there would stomp the in-progress edit (caret jumps, reverted
    // characters) since React won't re-render the textarea's own buffer but
    // the next read of blocksSnapshot would silently disagree with it. Keep
    // the actively edited block at its live local value instead — matched by
    // id, and read through the refs (not the captured-once render scope) so
    // it's the block the user is editing *now*, not whichever was active when
    // the session was joined. See preserveActiveEdit for the full rule.
    blocksToApply = preserveActiveEdit(
      blocksToApply,
      ids,
      activeBlockIndexRef.current,
      idsRef.current,
      blocksSnapshotRef.current,
      valuesRef.current,
    );

    // Only set for non-seeding joins, and only checked once — cleared here
    // regardless of outcome, so a legitimate later collaborative edit from
    // a peer never re-triggers this "did the room overwrite me" toast.
    const pending = pendingOverwriteCheckRef.current;
    if (pending) {
      pendingOverwriteCheckRef.current = null;
      const blocksChanged =
        pending.blocks.length !== blocksToApply.length ||
        pending.blocks.some((v, i) => v !== blocksToApply[i]);
      if (blocksChanged || pending.title !== titleToApply) {
        console.debug("[collab] applyDocToLocalState: room content replaced local content");
        onRoomContentReplaced?.();
      }
    }

    idsRef.current = ids.length ? ids : [crypto.randomUUID()];
    valuesRef.current = blocksToApply;
    lastAppliedBlocksRef.current = blocksToApply;
    lastAppliedTitleRef.current = titleToApply;
    setBlockIds(idsRef.current);
    setBlocksSnapshot(blocksToApply);
    // content is otherwise only ever kept current by blockActions on local
    // edits (see updateBlock/deactivateBlock) — a remote update bypasses
    // those, so without this, autosave (keyed off `content`, not
    // blocksSnapshot) never persists incoming peer edits, and the next
    // local blur rebuilds blocksSnapshot from the stale `content` and wipes
    // them right back out. See blockActions.ts's deactivateBlock.
    setContent(joinBlocks(blocksToApply));
    setTitle(titleToApply);
  }

  function createSession(): CollabSession {
    const session: CollabSession = new CollabSession(user, {
      onStatusChange: setStatus,
      onPeersChange: (next) => {
        peersRef.current = next;
        setPeers(next);
      },
      onDocChange: () => applyDocToLocalState(session),
    });
    sessionRef.current = session;
    setSession(session);
    return session;
  }

  // Persists the user's display name/color and, if a session is live,
  // applies it to the awareness state immediately — connected peers see the
  // change on their next awareness sync without either side reconnecting.
  function updateUser(next: CollabUser): void {
    const sanitized: CollabUser = { name: clampUserName(next.name), color: normalizeColor(next.color) };
    setUser(sanitized);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(sanitized));
    } catch {
      // localStorage unavailable — identity just won't persist across reloads
    }
    sessionRef.current?.setUser(sanitized);
  }

  // Tearing the session down (rather than just leaveRoom()) means the next
  // join starts from a fresh Y.Doc — otherwise this room's content would
  // linger and leak into whatever room is joined next.
  function performLeave(manual: boolean): void {
    // An explicit leave forgets this note's remembered manual room, so
    // reopening the note doesn't silently drop it back into the room it was
    // just taken out of. A folder-shared note still rejoins its folder-derived
    // room the next time it's opened — leaving is per-session, turning the
    // folder's sharing off is FolderShareButton's job.
    if (manual) forgetManualRoom(noteIdRef.current);
    pendingOverwriteCheckRef.current = null;
    pendingAdoptCheckRef.current = false;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setSession(null);
    roomIdRef.current = null;
    setRoomId(null);
    setRoomSource(null);
    setPeers([]);
    setStatus("idle");
  }

  function seedIfEmpty(session: CollabSession): void {
    if (session.order.length !== 0 || session.blockContents.size !== 0) return;
    // Read the live snapshot/title through refs, not the render scope: for a
    // non-seeding join this runs from the seed-fallback timer up to
    // SEED_FALLBACK_DELAY_MS after performJoin was called, by which point the
    // user may have typed — seed what's actually on screen, not the stale
    // join-time content.
    const blocks = blocksSnapshotRef.current;
    session.transact(() => {
      const ids = blocks.map(() => crypto.randomUUID());
      idsRef.current = ids;
      valuesRef.current = blocks;
      setBlockIds(ids);
      session.order.push(ids);
      ids.forEach((blockId, i) => session.blockContents.set(blockId, blocks[i]));
      session.meta.set("title", titleRef.current);
      // Lets a joiner arriving after this note tell which local note the
      // room's content belongs to (see the adoption check in
      // applyDocToLocalState). Every room now holds exactly one note —
      // folder rooms are derived per note (deriveNoteRoomId) rather than
      // shared by whichever note happens to be open — so this records the
      // note the room was created for.
      session.meta.set("noteId", noteIdRef.current);
    });
  }

  // `manual` distinguishes an explicit user action (share/join-by-id/URL —
  // recorded in `manualRoomsRef` under the active note, so it wins over that
  // note's folder-derived room and is rejoined whenever the note is reopened)
  // from the room-membership effect calling itself.
  // Always leaves whatever room is currently joined first: mistlib only
  // supports one active node at a time, so switching rooms without leaving
  // the old one first would throw, and reusing the same session's Y.Doc
  // across two different rooms would leak one room's content into the
  // other's.
  //
  // `seed` gates whether the locally-open note's content is written into
  // the room's Y.Doc:
  //   - true  ("this is a brand-new room", e.g. the share button or a
  //     folder's "generate new room" action): nobody else could possibly
  //     have content for this id yet, so seed immediately.
  //   - false (join-by-id, ?room= URL, an ordinary folder auto-join): the
  //     room may already have real content from a peer. Seeding immediately
  //     would race the incoming sync — both "sides" see an empty local doc
  //     and independently insert their own version, producing duplicated
  //     blocks once sync catches up (see blockDiff.ts's LCS reconciliation,
  //     which has no way to know the two inserts were meant to be the same
  //     note). Instead, wait SEED_FALLBACK_DELAY_MS for sync to pull in any
  //     existing content; only if the doc is *still* empty and nobody else
  //     is currently connected do we fall back to seeding — the case of
  //     being the first/only person to ever open this shared room.
  async function performJoin(id: string, manual: boolean, seed: boolean, forNoteId?: string): Promise<void> {
    console.debug("[collab] performJoin", { id, source: manual ? "manual" : "folder", seed });
    if (manual) rememberManualRoom(forNoteId ?? noteIdRef.current, id);
    if (sessionRef.current && roomIdRef.current === id) {
      setRoomSource(manual ? "manual" : "folder");
      return;
    }
    if (sessionRef.current) performLeave(false);

    const session = createSession();
    if (seed) {
      seedIfEmpty(session);
    } else {
      // Capture the note as it stood locally before any remote sync
      // arrives, so the first doc change this join receives can be
      // checked for whether it actually replaced local content.
      pendingOverwriteCheckRef.current = { blocks: blocksSnapshot, title };
      pendingAdoptCheckRef.current = manual;
    }

    await session.join(id);
    // If a subsequent performLeave/performJoin replaced the session while
    // this join() was in flight (rapid note switching), don't resurrect a
    // room id for a session that's already gone.
    if (sessionRef.current !== session) return;
    roomIdRef.current = id;
    setRoomId(id);
    setRoomSource(manual ? "manual" : "folder");

    if (!seed) {
      window.setTimeout(() => {
        if (sessionRef.current !== session) return; // moved on since
        if (peersRef.current.length > 0) {
          console.debug("[collab] performJoin: seed-fallback skipped, peers present", {
            id,
            peerCount: peersRef.current.length,
          });
          return; // someone's here — trust sync, don't clobber
        }
        console.debug("[collab] performJoin: seed-fallback timer firing, room still empty", { id });
        seedIfEmpty(session);
      }, SEED_FALLBACK_DELAY_MS);
    }
  }

  // Joins an existing room by id (pasted in via "join by room ID") or a
  // freshly generated one (the "share" flow, which passes `seed: true`).
  // Rejects empty/garbled input before it ever reaches mistlib's
  // joinRoom() — callers should catch and surface the error message to the
  // user.
  //
  // `forNoteId` names the note this room belongs to, for callers that join on
  // behalf of a note they've only just asked to be opened (the `?room=&note=`
  // invite-link flow) and so can't rely on `noteId` having caught up yet: the
  // room is remembered under that id, and the room-membership effect keeps
  // the join instead of tearing it down as another note's room when the
  // switch lands. Defaults to the note currently open, which is what an
  // in-app click means.
  async function joinRoom(
    idInput: string,
    opts: { seed?: boolean; forNoteId?: string } = {},
  ): Promise<void> {
    const id = idInput.trim();
    if (!isValidRoomId(id)) {
      throw new Error(t("useCollab.invalidRoomId"));
    }
    await performJoin(id, true, opts.seed ?? false, opts.forNoteId);
  }

  function leaveRoom(): void {
    performLeave(true);
  }

  // Call right before assigning a freshly-generated room id to the active
  // note's folder (the "generate new room" action in FolderShareButton),
  // passing that exact id, so the folder auto-join effect below seeds it
  // immediately instead of waiting on the empty-room fallback timer.
  function markNextFolderJoinAsNew(newRoomId: string): void {
    pendingSeedRoomIdRef.current = newRoomId;
  }

  // Room membership for the note currently on screen. Re-runs whenever the
  // active note changes or its folder's sharing does, and re-resolves from
  // scratch (see resolveTargetRoom) rather than letting the previous note's
  // membership carry over: opening a note that resolves to no room tears the
  // live session down, even if the note before it was being shared.
  useEffect(() => {
    const target = resolveTargetRoom(noteId, folderNoteRoomId, manualRoomsRef.current);
    if (target.roomId === roomIdRef.current) {
      // Already in the right room — e.g. the render right after a manual
      // join, which set both the room and the map entry itself. Nothing to
      // join or leave; only the source label can still need updating.
      if (target.roomId) setRoomSource(target.source);
      return;
    }
    if (target.roomId) {
      // Only seed if the pending id is exactly the folder this join's room
      // derives from — and clear it unconditionally either way, so a
      // "generate new room" for some other folder can never leak into
      // seeding this one.
      const seed = target.source === "folder" && pendingSeedRoomIdRef.current === sanitizedFolderRoomId;
      pendingSeedRoomIdRef.current = null;
      performJoin(target.roomId, target.source === "manual", seed).catch(() => {
        // Room is unreachable — stay local rather than surface an error for
        // what is, from the user's point of view, a background join.
      });
    } else {
      pendingSeedRoomIdRef.current = null;
      performLeave(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, folderNoteRoomId]);

  // Local -> Yjs, at per-block granularity. Skipped when this exact render
  // is the direct result of applying a remote update to local state (rather
  // than a genuine local edit), so that round-trip doesn't get rebroadcast.
  useEffect(() => {
    const isRemoteEcho =
      blocksSnapshot === lastAppliedBlocksRef.current && title === lastAppliedTitleRef.current;
    if (isRemoteEcho) {
      valuesRef.current = blocksSnapshot;
      return;
    }

    // Reconciled unconditionally (not just while a room is joined) so
    // per-block ids stay stable across structural edits (split/merge/
    // insert/delete) even outside collab — BlockEditor keys rows on these
    // ids rather than array index, so an id shift there would otherwise
    // remount/mismap the currently-focused textarea.
    const { ids: nextIds, removedIds, contentWrites, orderOps } = reconcileBlockIds(
      idsRef.current,
      valuesRef.current,
      blocksSnapshot,
      () => crypto.randomUUID(),
    );
    idsRef.current = nextIds;
    valuesRef.current = blocksSnapshot;
    setBlockIds(nextIds);

    const session = sessionRef.current;
    if (!session || !roomId) return;

    session.transact(() => {
      removedIds.forEach((id) => session.blockContents.delete(id));
      contentWrites.forEach(({ id, value }) => session.blockContents.set(id, value));
      // Targeted insert/delete at the changed positions only — never a
      // full delete+push of the whole order array, which would interleave
      // badly if two peers both make structural edits before syncing.
      orderOps.forEach((op) => {
        if (op.type === "delete") session.order.delete(op.index, op.count);
        else session.order.insert(op.index, op.ids);
      });
      session.meta.set("title", title);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksSnapshot, title, roomId]);

  useEffect(() => {
    if (roomId) sessionRef.current?.setLocalActiveBlock(activeBlockIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlockIndex, roomId]);

  useEffect(() => {
    return () => sessionRef.current?.destroy();
  }, []);

  // Notes the user has explicitly shared this session, for the sidebar's
  // per-note share markers. Notes in a shared folder are *also* shared but
  // aren't in here — that's derivable from the folder itself, and unlike
  // these it survives a reload (folder room ids are persisted; manual ones
  // live only in this session, or in a `?room=` URL).
  const manuallySharedNoteIds = useMemo(() => new Set(manualNoteIds), [manualNoteIds]);

  return {
    status,
    peers,
    blockIds,
    roomId,
    roomSource,
    session,
    joinRoom,
    leaveRoom,
    user,
    updateUser,
    markNextFolderJoinAsNew,
    manuallySharedNoteIds,
  };
}
