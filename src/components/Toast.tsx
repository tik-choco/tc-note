import { useT } from "../hooks/useAppSettings";
import { Icon } from "./Icon";

export interface ToastState {
  message: string;
  /** Omit for a plain info toast (no undo action to offer). */
  onUndo?: () => void;
}

export interface ToastItem extends ToastState {
  id: number;
}

export function Toast(props: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const { toasts, onDismiss } = props;
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    <div class="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} class="toast" role="status">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              type="button"
              class="toast-undo"
              onClick={() => {
                toast.onUndo?.();
                onDismiss(toast.id);
              }}
            >
              {t("toast.undo")}
            </button>
          )}
          <button type="button" class="toast-close" onClick={() => onDismiss(toast.id)} aria-label={t("toast.close")}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
