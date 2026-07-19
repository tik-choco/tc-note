import { useAppSettings, useT } from "../hooks/useAppSettings";
import { LANGUAGES, type Language } from "../lib/appSettings";
import type { TranslationKey } from "../lib/i18n";
import { requestOnboarding } from "../lib/onboarding";

// Each language is shown in its own name (autonym) so it's recognizable no
// matter the current UI language — the standard pattern for language pickers,
// and it avoids an N×N matrix of translated language names.
const LANGUAGE_LABELS: Record<Language, string> = {
  ja: "日本語",
  en: "English",
  zh: "中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ko: "한국어",
  pt: "Português",
};

// [label i18n key, literal key combo] — combos are keyboard keys, identical
// in both languages, so they stay out of the dictionary.
const SHORTCUTS: [TranslationKey, string][] = [
  ["appSettings.shortcuts.newNote", "Alt+N"],
  ["appSettings.shortcuts.search", "Ctrl+K"],
  ["appSettings.shortcuts.selectAllBlocks", "Ctrl+A"],
  ["appSettings.shortcuts.copyBlocks", "Ctrl+C"],
  ["appSettings.shortcuts.cutBlocks", "Ctrl+X"],
  ["appSettings.shortcuts.deleteBlocks", "Delete"],
  ["appSettings.shortcuts.deselect", "Esc"],
];

// General app preferences (UI language, keyboard-shortcut reference). Theme
// is toggled from the editor toolbar, not here — see EditorToolbar.
// Rendered as the "Display" tab inside SettingsModal — no dialog chrome of its
// own; the surrounding modal owns the overlay, header, and focus management.
export function AppSettingsPanel({ onClose }: { onClose: () => void }) {
  const { language, setLanguage } = useAppSettings();
  const t = useT();

  // Re-opening the wizard only makes sense once Settings itself is out of
  // the way, so this closes the modal in the same click that requests it.
  function handleReopenOnboarding() {
    requestOnboarding();
    onClose();
  }

  return (
    <>
      <div class="app-settings-section">
        <label class="app-settings-label" for="app-settings-language">{t("appSettings.language")}</label>
        <select
          id="app-settings-language"
          class="app-settings-select"
          value={language}
          onChange={(e) => setLanguage((e.target as HTMLSelectElement).value as Language)}
        >
          {LANGUAGES.map((opt) => (
            <option value={opt} key={opt}>
              {LANGUAGE_LABELS[opt]}
            </option>
          ))}
        </select>
      </div>

      <div class="app-settings-section">
        <span class="app-settings-label">{t("appSettings.shortcuts.title")}</span>
        <div class="app-settings-options">
          {SHORTCUTS.map(([labelKey, combo]) => (
            <div class="app-settings-option" key={labelKey}>
              <kbd>{combo}</kbd>
              {t(labelKey)}
            </div>
          ))}
        </div>
      </div>

      <div class="app-settings-section">
        <span class="app-settings-label">{t("settingsOnboarding.label")}</span>
        <p class="llm-settings-hint">{t("settingsOnboarding.description")}</p>
        <button type="button" onClick={handleReopenOnboarding}>
          {t("settingsOnboarding.button")}
        </button>
      </div>
    </>
  );
}
