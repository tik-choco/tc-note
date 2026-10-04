import { describe, expect, it } from "vitest";
import { aiSettingsMessages } from "../aiSettingsMessages";
import { LLM_SETTINGS_MESSAGES } from "@tik-choco/mistai/preact";

describe("AI settings locale completeness", () => {
  for (const catalogs of [aiSettingsMessages, LLM_SETTINGS_MESSAGES]) {
    for (const locale of ["ja", "zh-CN", "zh-TW"] as const) {
      it(`has complete nonempty keys and matching placeholders in ${locale}`, () => {
        const base = catalogs.en as Record<string, string>, other = catalogs[locale] as Record<string, string>;
        expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
        for (const key of Object.keys(base)) {
          expect(other[key].trim(), key).not.toBe("");
          expect(other[key].match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(base[key].match(/\{\w+\}/g)?.sort() ?? []);
        }
      });
    }
  }
});
