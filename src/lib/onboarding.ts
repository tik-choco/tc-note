// First-run onboarding (setup wizard) state: whether the wizard has been
// completed/dismissed, plus a same-tab pub/sub channel to re-open it on
// demand (e.g. from Settings). Modeled on tc-town's onboarding.ts and this
// codebase's appSettings.ts defensive-localStorage style: reads/writes never
// throw out to the caller — a broken/unavailable localStorage just means the
// wizard is skipped (never looped) rather than a hard crash.

const DONE_KEY = "tc-note:onboarding-done";

// Mirrors mistlib.ts's INDEX_KEY / NoteMeta[] shape. Read directly here
// (never import mistlib.ts, which pulls in the WASM note-storage backend)
// purely to sniff whether the user already has notes.
const NOTE_INDEX_KEY = "tc-note:index";

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    // Can't read storage — never loop the wizard because of a storage failure.
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // non-fatal: worst case the wizard reappears next launch
  }
}

/** True if `tc-note:index` holds at least one note (mistlib.ts's NoteMeta[] shape). */
function hasExistingNotes(): boolean {
  try {
    const raw = localStorage.getItem(NOTE_INDEX_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export function shouldShowOnboarding(): boolean {
  if (isOnboardingDone()) return false;
  // Migration guard: an install with notes but no done-flag predates this
  // feature — treat it as already onboarded rather than showing the wizard
  // to a returning user, and persist that so we don't re-check every launch.
  if (hasExistingNotes()) {
    markOnboardingDone();
    return false;
  }
  return true;
}

// Re-open channel: same-tab pub/sub so Settings (or anywhere else) can
// re-trigger the wizard without threading state through app.tsx props.
const listeners = new Set<() => void>();

export function subscribeOnboardingRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOnboarding(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[onboarding] listener failed", err);
    }
  }
}
