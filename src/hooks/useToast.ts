import { useRef, useState } from "preact/hooks";
import type { ToastItem } from "../components/Toast";

const TOAST_DURATION_MS = 6000;

// Toasts queue up instead of replacing each other, so a rapid second delete
// doesn't destroy the first one's undo. Each toast auto-dismisses on its own
// timer; showToast keeps the single-toast call shape.
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  function dismissToast(id: number) {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    // Returning the same array when nothing matched skips a state update —
    // useToast lives at the App root, so a stray update re-renders everything.
    setToasts((prev) => (prev.some((toast) => toast.id === id) ? prev.filter((toast) => toast.id !== id) : prev));
  }

  function showToast(message: string, onUndo?: () => void) {
    const id = nextIdRef.current++;
    setToasts((prev) => [...prev, { id, message, onUndo }]);
    timersRef.current.set(
      id,
      window.setTimeout(() => dismissToast(id), TOAST_DURATION_MS),
    );
  }

  return { toasts, showToast, dismissToast };
}
