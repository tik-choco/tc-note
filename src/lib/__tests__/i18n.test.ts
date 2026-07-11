import { describe, it, expect } from "vitest";
import { translate, translationKeys } from "../i18n";
import { LANGUAGES } from "../appSettings";
import { zh } from "../locales/zh";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { de } from "../locales/de";
import { ko } from "../locales/ko";
import { pt } from "../locales/pt";

// A superset of every interpolation field any Entry function reads, so every
// key can be rendered in every language to prove none throws or returns blank.
const SAMPLE_PARAMS = {
  count: 2,
  name: "Sample",
  detail: "detail",
  n: 1,
  model: "gpt-4o",
  imported: 3,
  skipped: 1,
  time: "12:00",
  error: "boom",
};

describe("i18n coverage", () => {
  for (const lang of LANGUAGES) {
    it(`renders every key in "${lang}" as a non-empty string`, () => {
      for (const key of translationKeys) {
        const out = translate(lang, key, SAMPLE_PARAMS);
        expect(typeof out, `${lang} / ${key} should be a string`).toBe("string");
        expect(out.length, `${lang} / ${key} is empty`).toBeGreaterThan(0);
      }
    });
  }

  // The en/ja base is always complete (enforced by the `satisfies` in i18n.ts);
  // the added languages are separate override maps. This guards against a new
  // key landing without a translation in every added language — which would
  // otherwise silently fall back to English at runtime.
  it("every added language translates every key (no silent English fallback)", () => {
    const overrides: Record<string, Partial<Record<string, unknown>>> = { zh, es, fr, de, ko, pt };
    for (const [lang, map] of Object.entries(overrides)) {
      const missing = translationKeys.filter((k) => !(k in map));
      expect(missing, `${lang} is missing keys: ${missing.join(", ")}`).toEqual([]);
    }
  });
});
