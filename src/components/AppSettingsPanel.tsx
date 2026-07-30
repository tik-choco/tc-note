import { useRef, useState } from "preact/hooks";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { useToast } from "../hooks/useToast";
import { Toast } from "./Toast";
import { LANGUAGES, type Language } from "../lib/appSettings";
import type { TranslationKey } from "../lib/i18n";
import { requestOnboarding } from "../lib/onboarding";
import { applyBackup, buildBackup, parseBackup } from "../lib/noteBackup";

// How long to leave the "imported" toast on screen before reloading, so the
// user actually gets to read it instead of the reload cutting it off
// instantly. Well under useToast's own auto-dismiss timer.
const IMPORT_RELOAD_DELAY_MS = 1200;

function backupFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `tc-note-backup-${date}.json`;
}

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

  // AppSettingsPanel only receives `onClose` from SettingsModal (no
  // app-level showToast is threaded down this far), so backup export/import
  // feedback uses its own local toast instance rather than the one at the
  // App root — same look (Toast reuses the shared .toast-stack styling), just
  // a separate queue scoped to this panel.
  const { toasts, showToast, dismissToast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Re-opening the wizard only makes sense once Settings itself is out of
  // the way, so this closes the modal in the same click that requests it.
  function handleReopenOnboarding() {
    requestOnboarding();
    onClose();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const backup = await buildBackup();
      const json = JSON.stringify(backup, null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = backupFileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      showToast(t("backup.exported", { count: backup.notes.length }));
    } catch (error) {
      console.error("backup export failed", error);
      showToast(t("backup.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      console.warn("backup import: invalid file:", result.reason);
      showToast(t("backup.invalidFile"));
      return;
    }

    const noteCount = result.backup.notes.length;
    // The note list lives in app.tsx's own state, which this panel has no
    // way to refresh directly — reloading is how the imported notes actually
    // show up, so the confirm text has to set that expectation up front.
    const confirmed = window.confirm(t("backup.importConfirm", { count: noteCount }));
    if (!confirmed) return;

    setImporting(true);
    try {
      const summary = await applyBackup(result.backup);
      showToast(t("backup.imported", { count: summary.notesImported }));
      window.setTimeout(() => window.location.reload(), IMPORT_RELOAD_DELAY_MS);
    } catch (error) {
      console.error("backup import failed", error);
      showToast(t("backup.importFailed"));
      setImporting(false);
    }
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

      <div class="app-settings-section">
        <span class="app-settings-label">{t("backup.section")}</span>
        <p class="llm-settings-hint">{t("backup.description")}</p>
        <button type="button" onClick={handleExport} disabled={exporting}>
          {exporting ? t("backup.exporting") : t("backup.export")}
        </button>
        <button type="button" onClick={() => importInputRef.current?.click()} disabled={importing}>
          {importing ? t("backup.importing") : t("backup.import")}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
