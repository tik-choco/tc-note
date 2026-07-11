import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { isImeComposing } from "../lib/util";

/**
 * Shared dismissal for popovers (outline panel, insert menu, collab/share
 * popovers): closes on Escape and on pointerdown outside `containerRef`.
 * pointerdown (not mousedown) so touch and pen dismiss the same way as a
 * mouse. Registered only while `open` so a page full of closed popovers
 * adds no document listeners.
 */
export function usePopoverDismiss(
  containerRef: RefObject<HTMLElement>,
  open: boolean,
  onDismiss: () => void,
) {
  // Fresh closure each render; listeners are registered per `open` flip.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const container = containerRef.current;
      if (container && e.target instanceof Node && !container.contains(e.target)) {
        onDismissRef.current();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape during an IME composition cancels the conversion, not the UI.
      if (e.key === "Escape" && !isImeComposing(e)) onDismissRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}
