// Desktop sidebar width, persisted to localStorage. Deliberately separate
// from appSettings.ts (theme/language) — this is a lightweight, purely
// visual preference that doesn't belong in the shared settings context.
// Mirrors appSettings.ts's storage convention: a "tc-note:" prefixed key,
// JSON-free (a bare number string is enough here), parsed defensively.
import { useCallback, useState } from "preact/hooks";

const WIDTH_KEY = "tc-note:sidebar-width";

export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 420;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return SIDEBAR_WIDTH_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable (private mode, quota, etc.) — width just won't
    // survive a reload; not worth surfacing to the user.
  }
}

export interface UseSidebarWidth {
  width: number;
  /** Clamp + apply immediately. Pass `persist: true` to also write through to
   * localStorage — callers keep drag-move frames unpersisted (cheap, live
   * tracking) and only persist on pointerup / keyboard step / reset, so a
   * fast drag doesn't hammer localStorage. Returns the clamped value. */
  setWidth: (next: number, persist?: boolean) => number;
  resetWidth: () => void;
}

export function useSidebarWidth(): UseSidebarWidth {
  const [width, setWidthState] = useState<number>(() => loadSidebarWidth());

  const setWidth = useCallback((next: number, persist = false): number => {
    const clamped = clampSidebarWidth(next);
    setWidthState(clamped);
    if (persist) saveSidebarWidth(clamped);
    return clamped;
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(SIDEBAR_WIDTH_DEFAULT);
    saveSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  }, []);

  return { width, setWidth, resetWidth };
}
