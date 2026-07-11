import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon";
import { useT } from "../hooks/useAppSettings";
import { detectSpeechLang, isCjk } from "../lib/langDetect";
import { buildTranslatePrompt, parseTranslateResponse, type TranslateResult } from "../lib/translatePopover";
import type { UseLlmNetResult } from "../hooks/useLlmNet";

// Selections longer than this aren't worth translating inline (and keep the
// popover — and the LLM call — cheap).
const MAX_SELECTION_LENGTH = 300;
// Wait for the selection to settle (e.g. a drag-select still in progress)
// before showing the popover and firing the LLM call.
const SETTLE_DELAY_MS = 300;
// Below this distance from the top of the viewport there isn't enough room
// to float the popover above the selection, so it opens downward instead.
const TOP_FLIP_THRESHOLD = 120;
const VIEWPORT_MARGIN = 16;

type PopoverPosition = { left: number; top: number; openDown: boolean };

function computePopoverPosition(rect: DOMRect): PopoverPosition {
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN),
  );
  const openDown = rect.top < TOP_FLIP_THRESHOLD;
  const top = openDown
    ? Math.min(rect.bottom, window.innerHeight - VIEWPORT_MARGIN)
    : Math.max(rect.top, VIEWPORT_MARGIN);
  return { left, top, openDown };
}

// Walks up from the selection's anchor node (which may be a text node) to
// find the nearest `.block-rendered` ancestor, if any.
function findRenderedBlock(node: Node | null): Element | null {
  if (!node) return null;
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest?.(".block-rendered") ?? null;
}

/**
 * Always-mounted global layer (see app.tsx) that watches the native text
 * selection and, when the user selects text inside a rendered block, shows a
 * small floating popover: a speaker button (Web Speech API TTS, needs no
 * network) plus an auto-fetched translation — with a pinyin/furigana-style
 * ruby reading over the selection when the text is Chinese/Japanese/Korean.
 *
 * A single `selectionchange` listener here (rather than one per block) is
 * what keeps this cheap regardless of note length.
 */
export function TranslateHoverLayer(props: { net: UseLlmNetResult; language: string }) {
  const { net, language } = props;
  const t = useT();

  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef(new Map<string, TranslateResult>());
  const settleTimerRef = useRef<number | null>(null);

  const transportBlocked =
    (net.connection === "network" && !net.networkAvailable) || (net.connection === "api" && !net.apiReady);

  function clearSettleTimer() {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }

  function hide() {
    clearSettleTimer();
    setSelectedText(null);
    setPosition(null);
    setResult(null);
    setLoading(false);
    setError(null);
  }

  // Single global listener set: selection changes decide whether to show the
  // popover; mousedown-outside, Escape, and scroll all dismiss it.
  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hide();
        return;
      }
      const text = sel.toString().trim();
      if (!text || text.length > MAX_SELECTION_LENGTH) {
        hide();
        return;
      }
      if (!findRenderedBlock(sel.anchorNode)) {
        hide();
        return;
      }

      const range = sel.getRangeAt(0);
      clearSettleTimer();
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        // Re-check the live selection hasn't collapsed/changed during the wait.
        const liveSel = window.getSelection();
        if (!liveSel || liveSel.isCollapsed || liveSel.toString().trim() !== text) return;
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        setSelectedText(text);
        setPosition(computePopoverPosition(rect));
      }, SETTLE_DELAY_MS);
    }

    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      hide();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    // Capturing so a scroll inside any inner scroll container also dismisses —
    // repositioning on scroll isn't worth the complexity, just hide.
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", hide, true);
      clearSettleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once a stable selection is shown, fetch (or reuse a cached) translation.
  // Cleanup flips `cancelled` so a stale reply from an abandoned selection
  // can't clobber a newer one's state.
  useEffect(() => {
    if (!selectedText) return;
    let cancelled = false;
    setResult(null);
    setError(null);

    if (transportBlocked) {
      setLoading(false);
      return;
    }

    const cacheKey = `${selectedText}::${language}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setResult(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    net
      .send(buildTranslatePrompt({ text: selectedText, targetLanguage: language }))
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseTranslateResponse(raw);
        cacheRef.current.set(cacheKey, parsed);
        setResult(parsed);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("translatePopover.error"));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText, language, transportBlocked]);

  if (!selectedText || !position) return null;

  function speak() {
    if (!selectedText) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedText);
    utterance.lang = detectSpeechLang(selectedText);
    window.speechSynthesis.speak(utterance);
  }

  const showReading = Boolean(result?.reading) && isCjk(selectedText);

  return (
    <div
      class={`translate-popover ${position.openDown ? "translate-popover--down" : ""}`}
      ref={popoverRef}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      // Never steal focus from the current selection — a mousedown on the
      // speaker button would otherwise collapse it before onClick runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div class="translate-popover-row">
        <button
          type="button"
          class="translate-popover-speak"
          onClick={speak}
          aria-label={t("translatePopover.listen")}
          title={t("translatePopover.listen")}
        >
          <Icon name="volume" size={16} />
        </button>
        {loading && <span class="translate-popover-status">{t("translatePopover.loading")}</span>}
        {!loading && transportBlocked && (
          <span class="translate-popover-status">{t("translatePopover.unavailable")}</span>
        )}
        {!loading && !transportBlocked && error && (
          <span class="translate-popover-status translate-popover-status--error">{error}</span>
        )}
      </div>

      {result && !loading && (
        <div class="translate-popover-body">
          {showReading && (
            <ruby class="translate-popover-ruby">
              {selectedText}
              <rt>{result.reading}</rt>
            </ruby>
          )}
          <div class="translate-popover-translation">{result.translation}</div>
        </div>
      )}
    </div>
  );
}
