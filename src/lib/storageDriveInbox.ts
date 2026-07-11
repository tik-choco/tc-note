// Best-effort publisher that makes a file dropped into tc-note also show up
// in tc-storage's drive (the sibling app at the same origin, see
// C:\Projects\tik-choco\tc-storage), via the shared bus rather than by
// writing tc-storage's own localStorage keys directly. See
// protocol/docs/data-contracts/docs/SHARED_BUS.md for the shared-bus contract
// and the `storage-drive-inbox` topic in particular.
//
// Contract (fixed): each dropped file is encrypted here with a fresh random
// AES-256-GCM key (never uploaded as plaintext — the mistlib block store may
// be P2P-visible), the ciphertext is uploaded via mistlib's storage_add to
// get a CID, and the CID plus the key/iv/checksum/metadata are appended to a
// rolling list of up to MAX_INBOX_ITEMS entries, republished wholesale via
// publishShared("storage-drive-inbox", "", { items }) — mirroring how
// tc-translate's translations-inbox topic republishes its full item list so
// tc-storage can import even while it was closed at drop time. tc-storage
// decrypts each item after its own storage_get(cid) and verifies the
// checksum before importing (see its src/app/appDriveInbox.ts) — it never
// reads a tc-storage-owned key from here.
//
// Best-effort: guarded on OPFS + Web Crypto availability and a size cap, and
// every failure is swallowed, so a file drop in tc-note itself never fails
// because of this side channel.
import { storage_add } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";
import { publishShared, readShared } from "./sharedBus";

const TOPIC = "storage-drive-inbox";
const MAX_INBOX_ITEMS = 50;

// tc-storage's own capacity is measured in GB (mistStorageMaxCapacityMb); this
// is only a sanity cap so a pathologically huge drop doesn't freeze the tab
// hashing/encrypting it on the main thread.
const MAX_SYNC_BYTES = 50 * 1024 * 1024;

/** One file entry in the `storage-drive-inbox` topic's `meta.items` list. */
export interface DriveInboxItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** SHA-256 hex digest of the plaintext bytes. */
  checksum: string;
  /** mistlib storage_add CID of the AES-GCM-encrypted bytes. */
  cid: string;
  /** Base64 raw AES-256-GCM key material. */
  key: string;
  /** Base64 96-bit AES-GCM IV. */
  iv: string;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

type NavigatorWithOpfs = Navigator & { storage?: StorageManager & { getDirectory?: () => Promise<unknown> } };

function hasOpfs(): boolean {
  const nav = globalThis.navigator as NavigatorWithOpfs | undefined;
  return typeof nav?.storage?.getDirectory === "function";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parses the current inbox record's items, tolerating malformed/missing meta (e.g. no record yet). */
export function parseExistingItems(meta: Record<string, unknown> | undefined): DriveInboxItem[] {
  const rawItems = meta ? (meta as { items?: unknown }).items : undefined;
  if (!Array.isArray(rawItems)) return [];
  const items: DriveInboxItem[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id === "string" && item.id &&
      typeof item.name === "string" &&
      typeof item.mimeType === "string" &&
      typeof item.size === "number" &&
      typeof item.checksum === "string" &&
      typeof item.cid === "string" &&
      typeof item.key === "string" &&
      typeof item.iv === "string" &&
      typeof item.addedAt === "string"
    ) {
      items.push({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        checksum: item.checksum,
        cid: item.cid,
        key: item.key,
        iv: item.iv,
        addedAt: item.addedAt,
      });
    }
  }
  return items;
}

/** Appends `item`, capping the rolling list at the most recent MAX_INBOX_ITEMS entries. */
export function appendInboxItem(existing: DriveInboxItem[], item: DriveInboxItem): DriveInboxItem[] {
  return [...existing, item].slice(-MAX_INBOX_ITEMS);
}

/**
 * Encrypts `file`'s bytes with a fresh AES-256-GCM key, uploads the
 * ciphertext to mistlib, and republishes the full (capped) drive-inbox item
 * list so tc-storage can import it. Best effort — failures (no OPFS, no Web
 * Crypto, storage_add error, oversized file) are swallowed so a dropped file
 * always still lands in the note itself regardless.
 */
export async function syncDroppedFileToTcStorage(file: File): Promise<void> {
  try {
    if (!hasOpfs() || !globalThis.crypto?.subtle) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_SYNC_BYTES) return;

    const checksum = await sha256Hex(bytes);
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["encrypt"]);
    const cipherText = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, cryptoKey, bytes as BufferSource),
    );

    await ensureMistNode();
    const id = crypto.randomUUID();
    const cid = await storage_add(`${id}.tc-drive-inbox.enc`, cipherText);

    const item: DriveInboxItem = {
      id,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: bytes.byteLength,
      checksum,
      cid,
      key: bytesToBase64(keyBytes),
      iv: bytesToBase64(iv),
      addedAt: new Date().toISOString(),
    };

    const existing = parseExistingItems(readShared(TOPIC)?.meta);
    publishShared(TOPIC, "", { items: appendInboxItem(existing, item) });
  } catch (error) {
    console.warn("tc-storage drive-inbox sync failed", error);
  }
}

export { TOPIC as storageDriveInboxTopic };
