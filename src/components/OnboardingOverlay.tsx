import { useState } from "preact/hooks";
import { formatMistaiError, MESSAGES_EN, MESSAGES_JA } from "@tik-choco/mistai";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { useModalA11y } from "../hooks/useModalA11y";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { requestApiChatCompletionStreaming } from "../lib/llm";
import { emptyLlmConfig, ensurePreset, ensureProvider, loadLlmConfig, resolvePreset, saveLlmConfig } from "../lib/llmConfig";
import type { TranslationKey } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
import "../styles/onboarding.css";

// First-run wizard shown by app.tsx as a centered modal overlay: welcome ->
// (optional) LLM connection -> feature tour. Every step is skippable, and
// every exit path (X, Escape, backdrop, the final 完了 button) just calls
// `props.onClose()` — this component never touches the "have we shown this
// before" flag itself; that's owned by the caller (see src/lib/onboarding.ts)
// so the settings screen can re-open this wizard at any time.

const STEP_COUNT = 3;

interface LlmDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

type TestState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "ok" }
  | { phase: "error"; message: string };

interface FeatureItem {
  icon: IconName;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

// tc-note's actual feature set, verified against the codebase: the block
// editor's slash-command menu (SlashMenu.tsx) and drag-to-reorder handle
// (BlockEditor.tsx's "drag-handle" icon), the outline rail (OutlinePanel.tsx,
// which itself uses the "list" icon), real-time collaboration + folder
// sharing (CollabButton.tsx / FolderShareButton.tsx, "people" icon), the AI
// chat panel + AI review panel (LlmChatPanel.tsx / ReviewPanel.tsx, toggled
// from EditorToolbar's "chat" icon), and select-to-translate with a listen
// button (TranslateHoverLayer.tsx, "volume" icon reused here for the same
// feature).
const FEATURES: FeatureItem[] = [
  { icon: "drag-handle", titleKey: "onboarding.feature.editor.title", descKey: "onboarding.feature.editor.desc" },
  { icon: "list", titleKey: "onboarding.feature.outline.title", descKey: "onboarding.feature.outline.desc" },
  { icon: "people", titleKey: "onboarding.feature.collab.title", descKey: "onboarding.feature.collab.desc" },
  { icon: "chat", titleKey: "onboarding.feature.ai.title", descKey: "onboarding.feature.ai.desc" },
  { icon: "volume", titleKey: "onboarding.feature.translate.title", descKey: "onboarding.feature.translate.desc" },
];

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

export function OnboardingOverlay(props: { onClose: () => void }) {
  const { onClose } = props;
  const t = useT();
  const { language } = useAppSettings();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;

  const [step, setStep] = useState(0);

  // The LLM draft starts from the shared config's resolved default preset (if
  // any) so re-running the wizard shows — and edits — the real current
  // connection instead of blank fields.
  const [llm, setLlm] = useState<LlmDraft>(() => {
    const shared = loadLlmConfig();
    const resolved = shared ? resolvePreset(shared) : null;
    return {
      baseUrl: resolved?.baseUrl ?? "",
      apiKey: resolved?.apiKey ?? "",
      model: resolved?.model ?? "",
    };
  });
  const [testState, setTestState] = useState<TestState>({ phase: "idle" });

  const modalRef = useModalA11y(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);

  function updateLlm(patch: Partial<LlmDraft>) {
    setLlm((prev) => ({ ...prev, ...patch }));
    // Edited connection values invalidate a previous test result.
    setTestState({ phase: "idle" });
  }

  /**
   * Merges the draft into the shared tc-shared-llm-config-v1 config via
   * ensureProvider/ensurePreset (dedup find-or-create, never overwriting
   * another app's entries — see llm-config.md's migration rule) instead of
   * writing tc-note's own local settings, so the wizard's edits show up
   * identically in Settings — and in every other participating app — afterward.
   */
  function saveLlmDraft() {
    const baseUrl = llm.baseUrl.trim();
    if (!baseUrl) return;
    const apiKey = llm.apiKey;
    const model = llm.model.trim();

    const shared = loadLlmConfig() ?? emptyLlmConfig();
    const providerId = ensureProvider(shared, { label: t("onboarding.llm.providerLabel"), baseUrl, apiKey });
    if (model) {
      const presetId = ensurePreset(shared, { label: model, providerId, model });
      if (!shared.defaultPresetId) shared.defaultPresetId = presetId;
    }
    saveLlmConfig(shared);
  }

  async function handleTest() {
    if (testState.phase === "busy" || !llm.baseUrl.trim()) return;
    setTestState({ phase: "busy" });
    try {
      await requestApiChatCompletionStreaming(
        { baseUrl: llm.baseUrl.trim(), apiKey: llm.apiKey, model: llm.model.trim() || undefined },
        [{ role: "user", content: t("onboarding.llm.testPrompt") }],
        () => {},
      );
      setTestState({ phase: "ok" });
    } catch (err) {
      const message = formatMistaiError(err, mistaiMessages, err instanceof Error ? err.message : String(err));
      setTestState({ phase: "error", message });
    }
  }

  function handleLlmNext() {
    saveLlmDraft();
    setStep(2);
  }

  return (
    <div class="ob-overlay" {...overlayDismiss}>
      <div
        class="ob-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.dialogLabel")}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button class="ob-close" type="button" onClick={onClose} title={t("onboarding.close")} aria-label={t("onboarding.close")}>
          <Icon name="close" size={18} />
        </button>

        {step === 0 && (
          <div class="ob-body">
            <div class="ob-hero">
              <Icon name="edit" size={36} />
            </div>
            <h2 class="ob-title">{t("onboarding.welcome.title")}</h2>
            <p class="ob-text">{t("onboarding.welcome.body1")}</p>
            <p class="ob-text">{t("onboarding.welcome.body2")}</p>
          </div>
        )}

        {step === 1 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Icon name="smart-toy" size={22} />
              <h2 class="ob-title">{t("onboarding.llm.title")}</h2>
            </div>
            <p class="ob-text">{t("onboarding.llm.intro")}</p>

            <div class="ob-field">
              <label class="ob-label" for="ob-llm-base-url">
                {t("onboarding.llm.baseUrlLabel")}
              </label>
              <input
                id="ob-llm-base-url"
                class="ob-input"
                type="text"
                placeholder={t("onboarding.llm.baseUrlPlaceholder")}
                value={llm.baseUrl}
                onInput={(e) => updateLlm({ baseUrl: inputValue(e) })}
              />
            </div>
            <div class="ob-field">
              <label class="ob-label" for="ob-llm-api-key">
                {t("onboarding.llm.apiKeyLabel")}
              </label>
              <input
                id="ob-llm-api-key"
                class="ob-input"
                type="password"
                placeholder={t("onboarding.llm.apiKeyPlaceholder")}
                value={llm.apiKey}
                onInput={(e) => updateLlm({ apiKey: inputValue(e) })}
              />
            </div>
            <div class="ob-field">
              <label class="ob-label" for="ob-llm-model">
                {t("onboarding.llm.modelLabel")}
              </label>
              <input
                id="ob-llm-model"
                class="ob-input"
                type="text"
                placeholder={t("onboarding.llm.modelPlaceholder")}
                value={llm.model}
                onInput={(e) => updateLlm({ model: inputValue(e) })}
              />
            </div>

            <div class="ob-test-row">
              <button
                class="ob-btn"
                type="button"
                onClick={() => void handleTest()}
                disabled={testState.phase === "busy" || !llm.baseUrl.trim()}
              >
                {testState.phase === "busy" ? <span class="spinner" /> : <Icon name="link" size={16} />}
                {testState.phase === "busy" ? t("onboarding.llm.testing") : t("onboarding.llm.test")}
              </button>
              {testState.phase === "ok" && (
                <span class="ob-test-ok">
                  <Icon name="check" size={16} />
                  {t("onboarding.llm.testOk")}
                </span>
              )}
            </div>
            {testState.phase === "error" && (
              <p class="ob-error">{t("onboarding.llm.testError", { detail: testState.message })}</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Icon name="check" size={22} />
              <h2 class="ob-title">{t("onboarding.tour.title")}</h2>
            </div>
            <ul class="ob-feature-list">
              {FEATURES.map((feature) => (
                <li key={feature.titleKey}>
                  <Icon name={feature.icon} size={16} />
                  <span>
                    <strong>{t(feature.titleKey)}</strong> — {t(feature.descKey)}
                  </span>
                </li>
              ))}
            </ul>
            <p class="ob-text ob-text-subtle">{t("onboarding.tour.closing")}</p>
          </div>
        )}

        <footer class="ob-footer">
          <div class="ob-dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} class={"ob-dot" + (i === step ? " is-active" : "")} />
            ))}
          </div>
          <div class="ob-footer-actions">
            {step > 0 && (
              <button class="ob-btn" type="button" onClick={() => setStep(step - 1)}>
                <Icon name="chevron-right" size={16} class="ob-icon-flip" />
                {t("onboarding.back")}
              </button>
            )}
            {step === 0 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={() => setStep(1)}>
                {t("onboarding.start")}
                <Icon name="chevron-right" size={16} />
              </button>
            )}
            {step === 1 && (
              <>
                <button class="ob-btn" type="button" onClick={() => setStep(2)}>
                  {t("onboarding.skip")}
                </button>
                <button class="ob-btn ob-btn-accent" type="button" onClick={handleLlmNext}>
                  {t("onboarding.llm.saveNext")}
                  <Icon name="chevron-right" size={16} />
                </button>
              </>
            )}
            {step === 2 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={onClose}>
                <Icon name="check" size={16} />
                {t("onboarding.done")}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
