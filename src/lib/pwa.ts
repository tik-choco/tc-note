// Thin Preact wrapper around vite-plugin-pwa's `virtual:pwa-register` (the
// framework-agnostic register, not `virtual:pwa-register/preact` — this app
// wants its own state shape and a `dismiss` action the built-in hook doesn't
// offer). Two concerns are kept separate on purpose:
//
//   - `pwaPromptReducer` is a pure function (no DOM, no service worker) so
//     it can be unit tested directly in vitest's default node environment.
//   - `usePwaUpdate` is the impure shell: it dynamically imports
//     `virtual:pwa-register` and drives the reducer from the service
//     worker's callbacks. The import is deferred into an effect body (never
//     evaluated at module scope) and gated on `serviceWorker` actually being
//     present, so merely importing this module is always safe — including
//     in a non-secure context, in a browser without SW support, or under
//     vitest, where `navigator`/`window` don't exist at all.
import { useEffect, useReducer, useRef } from "preact/hooks";

export interface PwaPromptState {
  needRefresh: boolean;
  offlineReady: boolean;
}

const initialPwaPromptState: PwaPromptState = { needRefresh: false, offlineReady: false };

type PwaPromptEvent = { type: "need-refresh" } | { type: "offline-ready" } | { type: "dismiss" };

// A pending update prompt takes priority: `offline-ready` only fires once,
// right after the very first install, so it should never clobber a later
// (more actionable) "a new version is ready" prompt if both were somehow
// pending at once.
export function pwaPromptReducer(state: PwaPromptState, event: PwaPromptEvent): PwaPromptState {
  switch (event.type) {
    case "need-refresh":
      return { needRefresh: true, offlineReady: false };
    case "offline-ready":
      return state.needRefresh ? state : { needRefresh: false, offlineReady: true };
    case "dismiss":
      return initialPwaPromptState;
    default:
      return state;
  }
}

// How long the (non-actionable) "ready to work offline" notice stays up
// before dismissing itself — matches the toast auto-dismiss ballpark
// (src/hooks/useToast.ts uses 6000ms for messages with an undo action; this
// one has no action at all, so a bit shorter reads as appropriately brief).
const OFFLINE_READY_AUTO_DISMISS_MS = 5000;

export interface PwaUpdateApi extends PwaPromptState {
  /** Applies the waiting service worker and reloads the page once it takes control. */
  updateSW: () => Promise<void>;
  dismiss: () => void;
}

export function usePwaUpdate(): PwaUpdateApi {
  const [state, dispatch] = useReducer(pwaPromptReducer, initialPwaPromptState);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled) return;
        updateSWRef.current = registerSW({
          onNeedRefresh: () => dispatch({ type: "need-refresh" }),
          onOfflineReady: () => dispatch({ type: "offline-ready" }),
          onRegisterError: (error) => {
            console.warn("[pwa] service worker registration failed", error);
          },
        });
      })
      .catch((error) => {
        // e.g. the plugin's virtual module genuinely isn't available in
        // this build/runtime — fail quiet, the app works fine without it.
        console.warn("[pwa] virtual:pwa-register unavailable", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.offlineReady) return;
    const timer = window.setTimeout(() => dispatch({ type: "dismiss" }), OFFLINE_READY_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [state.offlineReady]);

  return {
    ...state,
    updateSW: async () => {
      await updateSWRef.current?.(true);
    },
    dismiss: () => dispatch({ type: "dismiss" }),
  };
}
