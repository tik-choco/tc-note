import { useT } from "../hooks/useAppSettings";
import { usePwaUpdate } from "../lib/pwa";
import "../styles/pwa.css";

// Mounted once as a sibling of <App /> (see src/main.tsx) so it keeps
// working across note navigation and gets i18n from AppSettingsProvider.
// Renders nothing until there's actually something to say — see
// usePwaUpdate (src/lib/pwa.ts) for the need-refresh/offline-ready state
// machine and why the two never show at once.
export function PwaUpdatePrompt() {
  const t = useT();
  const { needRefresh, offlineReady, updateSW, dismiss } = usePwaUpdate();

  if (!needRefresh && !offlineReady) return null;

  return (
    <div class="pwa-prompt" role="status">
      {needRefresh ? (
        <>
          <span>{t("pwa.updateAvailable")}</span>
          <div class="pwa-prompt-actions">
            <button type="button" class="pwa-prompt-later" onClick={dismiss}>
              {t("pwa.later")}
            </button>
            <button type="button" class="pwa-prompt-update" onClick={() => void updateSW()}>
              {t("pwa.update")}
            </button>
          </div>
        </>
      ) : (
        <span>{t("pwa.offlineReady")}</span>
      )}
    </div>
  );
}
