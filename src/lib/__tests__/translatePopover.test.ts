import { describe, it, expect } from "vitest";
import { buildTranslatePrompt, parseTranslateResponse } from "../translatePopover";

describe("buildTranslatePrompt", () => {
  it("builds a system+user message pair mentioning the target language and carrying the raw text", () => {
    const messages = buildTranslatePrompt({ text: "你好", targetLanguage: "en" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("en");
    expect(messages[0].content.toLowerCase()).toContain("json");
    expect(messages[1]).toEqual({ role: "user", content: "你好" });
  });
});

describe("parseTranslateResponse", () => {
  it("parses plain JSON", () => {
    const result = parseTranslateResponse('{"translation":"hello","reading":"nǐ hǎo","sourceLanguage":"zh"}');
    expect(result).toEqual({ translation: "hello", reading: "nǐ hǎo", sourceLanguage: "zh" });
  });

  it("strips a ```json fenced reply", () => {
    const raw = '```json\n{"translation":"hello","reading":null,"sourceLanguage":"en"}\n```';
    expect(parseTranslateResponse(raw)).toEqual({ translation: "hello", reading: null, sourceLanguage: "en" });
  });

  it("strips a plain ``` fence with no language tag", () => {
    const raw = '```\n{"translation":"hi","reading":null,"sourceLanguage":"en"}\n```';
    expect(parseTranslateResponse(raw)).toEqual({ translation: "hi", reading: null, sourceLanguage: "en" });
  });

  it("accepts a null reading for non-CJK source text", () => {
    const result = parseTranslateResponse('{"translation":"hi","reading":null,"sourceLanguage":"en"}');
    expect(result.reading).toBeNull();
  });

  it("throws a descriptive error on non-JSON garbage", () => {
    expect(() => parseTranslateResponse("not json at all")).toThrow(/not valid JSON/);
  });

  it("throws when the translation field is missing", () => {
    expect(() => parseTranslateResponse('{"reading":null,"sourceLanguage":"en"}')).toThrow(/translation/);
  });

  it("throws when sourceLanguage is missing", () => {
    expect(() => parseTranslateResponse('{"translation":"hi","reading":null}')).toThrow(/sourceLanguage/);
  });

  it("throws when reading is neither a string nor null", () => {
    expect(() =>
      parseTranslateResponse('{"translation":"hi","reading":123,"sourceLanguage":"en"}'),
    ).toThrow(/reading/);
  });

  it("throws when the JSON parses to a non-object", () => {
    expect(() => parseTranslateResponse('"just a string"')).toThrow(/JSON object/);
  });
});
