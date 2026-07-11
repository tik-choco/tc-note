// Lightweight, script-based language detection for the translate-on-select
// popover (see TranslateHoverLayer.tsx). This deliberately doesn't try to be
// a real language identifier — it only distinguishes the scripts the popover
// cares about: Japanese kana (which implies Japanese even when mixed with
// kanji), Han-only text (Chinese), Hangul (Korean), and everything else.
const HIRAGANA_KATAKANA = /[぀-ヿ]/;
const CJK_IDEOGRAPH = /[一-鿿]/;
const HANGUL = /[가-힣]/;

/**
 * Picks a BCP-47 language tag for `SpeechSynthesisUtterance.lang` based on
 * the script(s) present in `text`. Kana (hiragana/katakana) wins over plain
 * Han ideographs since kanji-only substrings of Japanese text would
 * otherwise misdetect as Chinese.
 */
export function detectSpeechLang(text: string): string {
  if (HIRAGANA_KATAKANA.test(text)) return "ja-JP";
  if (CJK_IDEOGRAPH.test(text)) return "zh-CN";
  if (HANGUL.test(text)) return "ko-KR";
  return "en-US";
}

/** True if `text` contains any Japanese kana, CJK ideograph, or Hangul
 * character — used to decide whether the translate popover should ask for
 * (and render) a reading/ruby annotation. */
export function isCjk(text: string): boolean {
  return HIRAGANA_KATAKANA.test(text) || CJK_IDEOGRAPH.test(text) || HANGUL.test(text);
}
