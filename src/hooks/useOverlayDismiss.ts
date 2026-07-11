import { useRef } from "preact/hooks";
import type { JSX } from "preact";

/**
 * Click-to-dismiss handlers for a modal's backdrop overlay. A plain
 * `onClick={onClose}` on the overlay fires even when the user only meant to
 * drag-select text inside the modal: if the mousedown starts inside the
 * dialog and the mouseup lands outside it (dragging past the modal's edge),
 * browsers dispatch `click` on the nearest common ancestor of the two
 * targets, which is the overlay. Tracking that the mousedown itself also hit
 * the overlay (not a descendant) distinguishes a genuine outside click from
 * a selection drag that merely ends outside.
 */
export function useOverlayDismiss(onClose: () => void) {
  const mouseDownOnOverlay = useRef(false);

  function onMouseDown(e: JSX.TargetedMouseEvent<HTMLDivElement>) {
    mouseDownOnOverlay.current = e.target === e.currentTarget;
  }

  function onClick(e: JSX.TargetedMouseEvent<HTMLDivElement>) {
    if (mouseDownOnOverlay.current && e.target === e.currentTarget) onClose();
  }

  return { onMouseDown, onClick };
}
