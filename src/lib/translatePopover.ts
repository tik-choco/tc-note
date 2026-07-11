// Pure logic for the translate-on-select popover (see
// TranslateHoverLayer.tsx): building the LLM prompt and parsing its reply.
// No DOM access here so this stays cheaply unit-testable.
import type { ChatMessage } from "@tik-choco/mistai";

export interface TranslateResult {
  translation: string;
  reading: string | null;
  sourceLanguage: string;
}

/**
 * Builds a compact system+user message pair asking the model to translate
 * `text` into `targetLanguage`, along with a "reading" (pinyin/furigana/
 * romanization) when the text is Chinese, Japanese, or Korean, plus the
 * detected source language. The model is instructed to reply with nothing
 * but raw JSON so `parseTranslateResponse` can stay simple.
 */
export function buildTranslatePrompt(params: { text: string; targetLanguage: string }): ChatMessage[] {
  const { text, targetLanguage } = params;
  return [
    {
      role: "system",
      content: [
        `Translate the user's text into ${targetLanguage}.`,
        "If the text is Chinese, Japanese, or Korean, also provide its reading:",
        "pinyin with tone marks for Chinese, a furigana-style hiragana reading for Japanese,",
        "or a romanization for Korean. For any other source language, \"reading\" must be null.",
        'Detect the source language and report it as a short ISO 639-1-ish code (e.g. "en", "ja", "zh", "ko").',
        "Respond with ONLY raw JSON — no markdown code fences, no prose, no explanation — matching exactly:",
        '{"translation":string,"reading":string|null,"sourceLanguage":string}',
      ].join(" "),
    },
    {
      role: "user",
      content: text,
    },
  ];
}

// Strips a leading/trailing ```json or ``` fence, if present, before parsing.
// Self-contained (no shared "extract JSON from LLM reply" helper exists yet
// in this branch) so this file has no dependency on code elsewhere.
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * Parses the model's reply into a validated `TranslateResult`. Throws a
 * descriptive `Error` (never returns a partial/garbage shape) if the reply
 * isn't JSON, isn't an object, or is missing/mistypes a required field.
 */
export function parseTranslateResponse(raw: string): TranslateResult {
  const stripped = stripCodeFence(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Translate response was not valid JSON: ${detail}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Translate response was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.translation !== "string") {
    throw new Error('Translate response is missing a string "translation" field');
  }
  if (typeof obj.sourceLanguage !== "string") {
    throw new Error('Translate response is missing a string "sourceLanguage" field');
  }
  if (obj.reading !== null && typeof obj.reading !== "string") {
    throw new Error('Translate response "reading" field must be a string or null');
  }

  return {
    translation: obj.translation,
    reading: (obj.reading as string | null) ?? null,
    sourceLanguage: obj.sourceLanguage,
  };
}
