import type { JSX } from "preact";

// A small, self-drawn icon set in a consistent Material-style outlined
// language (24x24 grid, 2px round-capped stroke) — deliberately not the
// literal Material Symbols glyphs (whose exact path data isn't something to
// reproduce from memory reliably), but the same visual grammar: geometric,
// single-weight, no fill. Centralizing icons here is also what fixes the
// inconsistencies an icon survey turned up — e.g. delete used to mean
// either "×" (dismiss) or "🗑" (remove) depending on which file you were in;
// now there's exactly one "delete" name.
export type IconName =
  | "menu"
  | "search"
  | "add"
  | "settings"
  | "smart-toy"
  | "link"
  | "people"
  | "star"
  | "star-outline"
  | "check"
  | "close"
  | "delete"
  | "more-vert"
  | "content-copy"
  | "arrow-forward"
  | "upload"
  | "history"
  | "edit"
  | "folder"
  | "chevron-right"
  | "chevron-down"
  | "list"
  | "chat"
  | "send"
  | "drag-handle"
  | "volume"
  | "rubric"
  | "share"
  | "sun"
  | "moon"
  | "keyboard"
  | "stop";

// 5-point star, precomputed for a 24x24 viewBox (outer radius 10, inner
// radius ~3.8, centered at 12,12) rather than hand-guessed coordinates.
const STAR_POINTS = "12,2.5 14.6,9.1 21.8,9.5 16.1,14.1 18,21.1 12,17 6,21.1 7.9,14.1 2.2,9.5 9.4,9.1";

const PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </>
  ),
  add: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  "smart-toy": (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <line x1="12" y1="8" x2="12" y2="4" />
      <circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="13.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13.5" r="1.3" fill="currentColor" stroke="none" />
      <line x1="9" y1="17.5" x2="15" y2="17.5" />
    </>
  ),
  link: (
    <>
      <rect x="3" y="8" width="9" height="8" rx="4" />
      <rect x="12" y="8" width="9" height="8" rx="4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M15.5 19c.3-2.3 1.9-4 3.8-4.3" />
    </>
  ),
  star: <polygon points={STAR_POINTS} fill="currentColor" />,
  "star-outline": <polygon points={STAR_POINTS} fill="none" />,
  check: <polyline points="4,13 9,18 20,6" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  delete: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  // Three-dot "kebab" trigger for the note row's overflow menu — same filled-
  // dot grammar as `list`'s bullets, stacked vertically.
  "more-vert": (
    <>
      <circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  "content-copy": (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </>
  ),
  "arrow-forward": (
    <>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13,6 19,12 13,18" />
    </>
  ),
  upload: (
    <>
      <polyline points="8,10 12,6 16,10" />
      <line x1="12" y1="6" x2="12" y2="15" />
      <path d="M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="13" r="8" />
      <polyline points="12,9 12,13 15,15" />
      <polyline points="4,4 4,8 8,8" />
      <path d="M4.5 8A8 8 0 0 1 12 5" />
    </>
  ),
  edit: (
    <>
      <path d="M6 18.5L5 19l.5-1L16 7.5l1.5 1.5L7 19.5z" />
      <line x1="14.5" y1="5.5" x2="18.5" y2="9.5" />
    </>
  ),
  folder: <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />,
  "chevron-right": <polyline points="9,5 16,12 9,19" />,
  "chevron-down": <polyline points="5,9 12,16 19,9" />,
  list: (
    <>
      <circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" />
      <line x1="8" y1="7" x2="20" y2="7" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" />
      <line x1="8" y1="17" x2="20" y2="17" />
    </>
  ),
  // Rounded speech bubble with a tail — the assistant chat toggle.
  chat: (
    <>
      <path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5a1 1 0 0 1 1-1z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="12.5" x2="13" y2="12.5" />
    </>
  ),
  // Paper-plane send glyph.
  send: (
    <>
      <path d="M4 12l16-7-7 16-2.5-6.5z" />
      <line x1="10.5" y1="14.5" x2="20" y2="5" />
    </>
  ),
  // Six-dot grip — the block drag handle. Same dot grammar as `list`'s
  // bullets (filled circles, no stroke), arranged in two columns of three.
  "drag-handle": (
    <>
      <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  // Speaker cone + sound waves — the "listen" (TTS) button in the translate
  // popover.
  volume: (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4z" />
      <path d="M16.5 9a4.5 4.5 0 0 1 0 6" />
      <path d="M19 6.5a8.5 8.5 0 0 1 0 11" />
    </>
  ),
  // Clipboard with a checkmark — the "Review" panel toggle.
  rubric: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <polyline points="8.5,13 10.5,15 15.5,10" />
    </>
  ),
  // Classic three-node share glyph — used for pushing a note out to another
  // app (tc-chat), distinct from "send" (in-app chat message) and
  // "arrow-forward" (open/navigate).
  share: (
    <>
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="18" r="2.3" />
      <line x1="8.1" y1="10.8" x2="15.9" y2="7.2" />
      <line x1="8.1" y1="13.2" x2="15.9" y2="16.8" />
    </>
  ),
  // Light-theme glyph: circle with eight radiating rays.
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="2.5" x2="12" y2="5.2" />
      <line x1="12" y1="18.8" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5.2" y2="12" />
      <line x1="18.8" y1="12" x2="21.5" y2="12" />
      <line x1="5" y1="5" x2="6.9" y2="6.9" />
      <line x1="17.1" y1="17.1" x2="19" y2="19" />
      <line x1="5" y1="19" x2="6.9" y2="17.1" />
      <line x1="17.1" y1="6.9" x2="19" y2="5" />
    </>
  ),
  // Dark-theme glyph: crescent moon.
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  // A keyboard outline with a row of key dots and a wide spacebar — the
  // shortcuts-cheat-sheet trigger in the status bar.
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="14.5" x2="17.5" y2="14.5" />
    </>
  ),
  // Filled rounded square — the "stop" control shown in place of send while
  // a chat reply is streaming, to cancel the queued/running AI task.
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
};

export function Icon(props: { name: IconName; size?: number; class?: string }) {
  const { name, size = 20, class: className } = props;
  return (
    <svg
      class={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
