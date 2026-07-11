import { useEffect, useRef, useState } from "preact/hooks";
import type { OutlineItem } from "../lib/outline";
import { useT } from "../hooks/useAppSettings";
import { usePopoverDismiss } from "../hooks/usePopoverDismiss";
import { Icon } from "./Icon";

// A heading counts as "in view" once it scrolls to within this many px of
// the scroll container's top edge, matching where a reader's eye lands
// rather than the exact pixel boundary.
const SCROLL_SPY_OFFSET = 96;

function dashLevelClass(level: number): string {
  const clamped = level >= 3 ? 3 : level;
  return `outline-rail__dash--level${clamped}`;
}

export function OutlinePanel(props: { outline: OutlineItem[]; onJump: (offset: number) => void }) {
  const { outline, onJump } = props;
  const t = useT();
  // CSS :hover / :focus-within still opens the panel for pointer and
  // keyboard users; this state covers touch, where neither ever fires.
  const [open, setOpen] = useState(false);
  const [activeOffset, setActiveOffset] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(rootRef, open, () => setOpen(false));

  // Scroll-spy: mark the outline item for the last heading that has
  // scrolled above the container's top edge (+ a small offset). Rendered
  // headings live under .block-editor in the same document order as the
  // outline items, since both derive from the same markdown — pair them
  // positionally. If the counts don't match (a "#" inside a fenced code
  // block, which extractOutline skips, or a block mid-edit rendering a
  // textarea instead of its heading), degrade to no highlight rather than
  // risk pointing at the wrong section.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scrollContainer =
      (root.closest(".content-area") as HTMLElement | null) ?? root.parentElement;
    const blockEditor = scrollContainer?.querySelector(".block-editor");
    if (!scrollContainer || !blockEditor || outline.length === 0) {
      setActiveOffset(null);
      return;
    }

    let frame = 0;
    const updateActive = () => {
      frame = 0;
      const headings = Array.from(
        blockEditor.querySelectorAll("h1, h2, h3, h4, h5, h6"),
      ) as HTMLElement[];
      if (headings.length !== outline.length) {
        setActiveOffset(null);
        return;
      }
      const threshold = scrollContainer.getBoundingClientRect().top + SCROLL_SPY_OFFSET;
      let activeIndex = -1;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= threshold) activeIndex = i;
        else break;
      }
      setActiveOffset(activeIndex === -1 ? null : outline[activeIndex].offset);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(updateActive);
    };

    updateActive();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scrollContainer.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [outline]);

  return (
    <div class="outline-hover-zone" ref={rootRef}>
      {/* Narrow viewports: trigger + popover. Hidden past the wide breakpoint. */}
      <button
        type="button"
        class="outline-trigger"
        title={t("outline.toggle")}
        aria-label={t("outline.toggle")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="list" />
      </button>

      {/* Wide viewports: a quiet always-on rail, one dash per heading. */}
      {outline.length > 0 && (
        <nav class="outline-rail" aria-label={t("outlinePanel.heading")}>
          {outline.map((item) => (
            <button
              key={item.offset}
              type="button"
              class={`outline-rail__dash ${dashLevelClass(item.level)} ${
                item.offset === activeOffset ? "outline-rail__dash--active" : ""
              }`}
              title={item.text || t("outlinePanel.untitledHeading")}
              aria-label={item.text || t("outlinePanel.untitledHeading")}
              aria-current={item.offset === activeOffset ? "true" : undefined}
              onClick={() => onJump(item.offset)}
            />
          ))}
        </nav>
      )}

      {/* Full heading list: the narrow popover, and the wide rail's hover/
          focus-within expansion. --open covers keyboard and touch (Enter/
          tap toggles it in the component) for the narrow trigger; the rail
          expands purely on :hover / :focus-within (see outline.css). */}
      <div class={`outline-panel ${open ? "outline-panel--open" : ""}`}>
        <h4>{t("outlinePanel.heading")}</h4>
        {outline.length === 0 && <p class="outline-empty">{t("outlinePanel.empty")}</p>}
        <ul>
          {outline.map((item) => (
            <li
              key={item.offset}
              class="outline-item"
              data-level={Math.min(item.level, 3)}
              style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
            >
              <button
                type="button"
                class={item.offset === activeOffset ? "outline-panel__item--active" : ""}
                onClick={() => onJump(item.offset)}
              >
                {item.text || t("outlinePanel.untitledHeading")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
