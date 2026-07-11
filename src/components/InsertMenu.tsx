import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { INSERT_OPTIONS, resolveScaffold } from "../lib/blockScaffolds";
import { useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

// The "+" insert menu: a small trigger button that opens a list of block
// scaffolds (見出し、リスト、表、図 etc). Manages its own open/closed state
// so callers just wire up what happens once something is picked.
export function InsertMenu(props: {
  onInsert: (scaffold: string, focus: boolean) => void;
  className?: string;
  title?: string;
}) {
  const { onInsert, className, title } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  usePopoverDismiss(ref, open, () => {
    setOpen(false);
    // Menu pattern: dismissal hands focus back to the trigger.
    triggerRef.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    // Menu pattern: focus lands on the first item when the menu opens.
    listRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);

  function handleListKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  }

  return (
    <div class={`insert-menu ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        class="insert-menu-trigger"
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={title ?? t("insertMenu.addBlock")}
        aria-label={t("insertMenu.addBlock")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="add" size={16} />
      </button>
      {open && (
        <div class="insert-menu-list" role="menu" ref={listRef} onKeyDown={handleListKeyDown}>
          {INSERT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              class="insert-menu-item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                // Hand focus back to the trigger unless the inserted block
                // is about to take it.
                if (!opt.focus) triggerRef.current?.focus();
                onInsert(resolveScaffold(opt, t), opt.focus);
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
