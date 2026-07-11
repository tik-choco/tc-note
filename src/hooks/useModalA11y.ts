import { useEffect, useRef } from "preact/hooks";
import { isImeComposing } from "../lib/util";

// Candidate elements a modal can reasonably move focus to. Disabled controls
// and tabindex="-1" elements are filtered out afterward via the `tabIndex`
// IDL property (see `focusables()` below) rather than in this selector,
// since disabled native controls already report tabIndex === -1 and this
// keeps the exclusion uniform for a roving-tabindex tab (tabIndex={-1} on a
// plain, non-disabled <button>).
const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]';

export type UseModalA11yOptions = {
  /**
   * Overrides which element receives focus on mount. Return the element to
   * focus, or null/undefined to fall back to the default (first focusable
   * descendant). Use this when the first-in-DOM element isn't the right
   * initial target — e.g. a header close button that would otherwise grab
   * focus, making a stray Enter immediately dismiss the dialog. Most modals
   * don't need this; omit it to keep the default behavior.
   */
  initialFocus?: () => HTMLElement | null;
};

/**
 * Shared dialog behavior for the app's modals: focuses the first focusable
 * element on mount (or `options.initialFocus`, if given), traps Tab/Shift+Tab
 * inside the container, closes on Escape, and restores focus to the invoking
 * element on unmount. The caller still declares the ARIA wiring
 * (role="dialog" aria-modal="true" aria-labelledby) on the container in JSX,
 * plus this ref.
 */
export function useModalA11y(onClose: () => void, options?: UseModalA11yOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Modals receive a fresh onClose closure each render; the keydown listener
  // is registered once, so read the latest through a ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Same story for the initial-focus override: read the latest through a
  // ref so the mount effect (which must run only once) still sees it.
  const initialFocusRef = useRef(options?.initialFocus);
  initialFocusRef.current = options?.initialFocus;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.tabIndex !== -1,
      );

    const requested = initialFocusRef.current?.();
    const first = requested ?? focusables()[0];
    if (first) {
      first.focus();
    } else {
      container.tabIndex = -1;
      container.focus();
    }

    // Arrow (not function declaration) so the null-narrowing of `container`
    // above carries into the closure.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape during an IME composition cancels the conversion; closing
        // the modal then would destroy the half-typed form.
        //
        // Known gap, deliberately not worked around: if a native <select>'s
        // dropdown is open (e.g. the language or model pickers), some
        // browsers first let Escape close just the dropdown and never emit a
        // document-level keydown for it, while others (this varies by
        // browser/OS and isn't observable from script — there's no DOM event
        // or attribute exposing "this select's popup is currently open") let
        // it bubble here and close the whole modal too. Filtering on
        // `e.target` can't distinguish "select with popup open" from "select,
        // focused, popup already closed," so a guard here would just as often
        // block a legitimate Escape-closes-modal press. Left as-is.
        if (!isImeComposing(e)) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at the edges; also catch focus sitting on the container itself
      // (the no-focusables fallback above) or having escaped the modal.
      if (e.shiftKey && (active === firstItem || !container.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !container.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      invoker?.focus();
    };
  }, []);

  return containerRef;
}
