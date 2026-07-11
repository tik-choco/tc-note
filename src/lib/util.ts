export const UNFILED = "__unfiled__";

export function newId(): string {
  return crypto.randomUUID();
}

// The JS side of the responsive breakpoint. Must stay in sync with the
// literal 768px @media blocks in the stylesheets (layout.css, editor.css,
// toolbar.css, index.css) — CSS media queries can't read a shared constant.
export const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

export function isNarrowScreen(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

// True while an IME composition is in flight (kana conversion etc.).
// Escape/Enter handlers must bail then — those keys belong to the IME, not
// the app. keyCode 229 covers engines that don't set isComposing on the
// final keydown of a composition.
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

// Picks where to restore focus after a per-item element (a row, a form tied
// to one item) unmounts — e.g. LlmSettingsPanel's provider edit form or a
// deleted provider's own controls. Prefers the still-present element keyed
// to `id` (so editing/canceling provider A re-focuses A's own edit button);
// falls back to a stable, always-rendered element (e.g. the "add" button)
// when there's no such id (a brand-new item, or the item itself was
// removed). Without *some* explicit refocus, the browser drops focus to
// <body> once the previously-focused element unmounts.
export function pickFocusAfterUnmount<T>(
  id: string | null,
  byId: Record<string, T | null | undefined>,
  fallback: T | null,
): T | null {
  return (id ? byId[id] : null) ?? fallback ?? null;
}

// Intl formatter construction is expensive and these run per note row on
// every render, so cache per locale (the app only ever uses "ja"/"en").
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();

function cached<T>(cache: Map<string, T>, locale: string, create: (locale: string) => T): T {
  let fmt = cache.get(locale);
  if (!fmt) {
    fmt = create(locale);
    cache.set(locale, fmt);
  }
  return fmt;
}

// `locale` is the UI language (a BCP 47 tag, e.g. "ja"/"en") so timestamps
// follow the app's language setting rather than the browser default.
export function formatTime(ts: number, locale: string): string {
  return cached(dateTimeFormats, locale, (l) =>
    new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: "short" }),
  ).format(new Date(ts));
}

export function formatRelativeTime(ts: number, locale: string): string {
  const rtf = cached(relativeTimeFormats, locale, (l) => new Intl.RelativeTimeFormat(l, { numeric: "auto" }));
  const diffSec = Math.round((Date.now() - ts) / 1000);
  // numeric:"auto" renders 0 seconds as "now"/「今」 rather than "0秒前".
  if (diffSec < 10) return rtf.format(0, "second");
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return rtf.format(-diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return rtf.format(-diffDay, "day");
  return cached(dateFormats, locale, (l) => new Intl.DateTimeFormat(l, { dateStyle: "medium" })).format(
    new Date(ts),
  );
}
