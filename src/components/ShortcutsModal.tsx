import { useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import type { TranslationKey } from "../lib/i18n";
import { Icon } from "./Icon";

// True on macOS/iOS, where shortcuts are conventionally shown with the
// symbolic modifier glyphs (⌘⇧⌥) instead of the word "Ctrl". Checked once at
// module load — the platform doesn't change mid-session.
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? navigator.platform ?? "");

// A key combo as an ordered list of literal tokens ("Ctrl"/"Cmd" is written
// as "Mod" and swapped for the platform's real key at render time).
type Combo = string[];

function renderKey(token: string): string {
  if (token !== "Mod") return token;
  return isMac ? "⌘" : "Ctrl";
}

type Row = { labelKey: TranslationKey; combo: Combo };
type Group = { titleKey: TranslationKey; rows: Row[] };

// Mirrors (and extends) the short list already shown in the display-settings
// panel (AppSettingsPanel.tsx) — this modal is the full reference card, so it
// reuses those i18n keys where the shortcut is the same and adds the ones
// that panel never covered (global search, the slash menu, mouse/keyboard
// selection extension, splitting a block).
const GROUPS: Group[] = [
  {
    titleKey: "shortcutsModal.group.global",
    rows: [
      { labelKey: "appSettings.shortcuts.newNote", combo: ["Alt", "N"] },
      { labelKey: "appSettings.shortcuts.search", combo: ["Mod", "K"] },
      { labelKey: "shortcutsModal.globalSearch", combo: ["Mod", "Shift", "F"] },
      { labelKey: "shortcutsModal.toggle", combo: ["Mod", "/"] },
    ],
  },
  {
    titleKey: "shortcutsModal.group.blocks",
    rows: [
      { labelKey: "appSettings.shortcuts.selectAllBlocks", combo: ["Mod", "A"] },
      { labelKey: "shortcutsModal.shiftClick", combo: ["Shift", "Click"] },
      { labelKey: "shortcutsModal.shiftArrows", combo: ["Shift", "↑/↓"] },
      { labelKey: "appSettings.shortcuts.copyBlocks", combo: ["Mod", "C"] },
      { labelKey: "appSettings.shortcuts.cutBlocks", combo: ["Mod", "X"] },
      { labelKey: "appSettings.shortcuts.deleteBlocks", combo: ["Delete"] },
      { labelKey: "appSettings.shortcuts.deselect", combo: ["Esc"] },
    ],
  },
  {
    titleKey: "shortcutsModal.group.noteList",
    rows: [
      { labelKey: "shortcutsModal.noteRange", combo: ["Shift", "Click"] },
      { labelKey: "shortcutsModal.noteToggle", combo: ["Mod", "Click"] },
      { labelKey: "appSettings.shortcuts.deselect", combo: ["Esc"] },
    ],
  },
  {
    titleKey: "shortcutsModal.group.editing",
    rows: [
      { labelKey: "shortcutsModal.slashMenu", combo: ["/"] },
      { labelKey: "shortcutsModal.splitBlock", combo: ["↵"] },
    ],
  },
];

// A calm, read-only reference card for the app's keyboard shortcuts (Ctrl/
// Cmd+/). Structurally a plain sibling of GlobalSearchModal / SettingsModal:
// same overlay + dialog chrome, same useModalA11y focus trap / Escape /
// refocus behavior. There's nothing to type here, so unlike GlobalSearchModal
// the first focusable element is the close button.
export function ShortcutsModal(props: { onClose: () => void }) {
  const { onClose } = props;
  const t = useT();
  const modalRef = useModalA11y(onClose);

  return (
    <div class="shortcuts-overlay" onClick={onClose}>
      <div
        class="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="shortcuts-header">
          <h2 id="shortcuts-title">{t("shortcutsModal.title")}</h2>
          <button type="button" class="icon-btn" onClick={onClose} aria-label={t("appSettings.close")}>
            <Icon name="close" />
          </button>
        </div>

        <div class="shortcuts-body">
          {GROUPS.map((group) => (
            <div class="shortcuts-group" key={group.titleKey}>
              <h3 class="shortcuts-group-title">{t(group.titleKey)}</h3>
              <div class="shortcuts-rows">
                {group.rows.map((row) => (
                  <div class="shortcuts-row" key={row.labelKey}>
                    <span class="shortcuts-row-label">{t(row.labelKey)}</span>
                    <span class="shortcuts-row-combo">
                      {row.combo.map((token, i) => (
                        <kbd class="shortcuts-kbd" key={i}>
                          {renderKey(token)}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
