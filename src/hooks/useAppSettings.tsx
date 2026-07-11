import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
  type Language,
  type Theme,
} from "../lib/appSettings";
import { translate, type TranslationKey } from "../lib/i18n";

interface AppSettingsContextValue {
  theme: Theme;
  /** The theme actually in effect: "system" resolved against the OS scheme.
   * The single source of truth for JS consumers that render themed content
   * (mermaid etc.) — mirrors the :not([data-theme]) fallback in index.css. */
  resolvedTheme: "light" | "dark";
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

// Applies the user's theme choice to the document root: an explicit
// light/dark sets data-theme so it wins over OS preference (see the
// :not([data-theme]) guard in index.css); "system" clears the attribute so
// the prefers-color-scheme media query takes back over.
function applyTheme(theme: Theme): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function AppSettingsProvider(props: { children: ComponentChildren }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  // One live OS-scheme subscription for the whole app; consumers read the
  // resolved theme from context instead of each holding a matchMedia listener.
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // Keep the document's lang attribute in sync so assistive tech and the
  // browser (spellcheck, font selection) follow the UI language.
  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  function persist(next: AppSettings) {
    setSettings(next);
    saveAppSettings(next);
  }

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      theme: settings.theme,
      resolvedTheme: settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme,
      language: settings.language,
      setTheme: (theme) => persist({ ...settings, theme }),
      setLanguage: (language) => persist({ ...settings, language }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, systemDark],
  );

  return <AppSettingsContext.Provider value={value}>{props.children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within an AppSettingsProvider");
  return ctx;
}

/** Returns a `t(key, params?)` function bound to the current UI language. */
export function useT(): (key: TranslationKey, params?: Record<string, string | number>) => string {
  const { language } = useAppSettings();
  return useMemo(() => (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params), [language]);
}
