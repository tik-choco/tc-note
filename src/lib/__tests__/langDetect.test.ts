import { describe, it, expect } from "vitest";
import { detectSpeechLang, isCjk } from "../langDetect";

describe("detectSpeechLang", () => {
  it("detects Japanese text containing kana", () => {
    expect(detectSpeechLang("こんにちは")).toBe("ja-JP");
  });

  it("detects Japanese text mixing kanji and kana", () => {
    expect(detectSpeechLang("日本語を勉強しています")).toBe("ja-JP");
  });

  it("detects Chinese text made only of Han characters", () => {
    expect(detectSpeechLang("你好世界")).toBe("zh-CN");
  });

  it("detects Korean text (Hangul)", () => {
    expect(detectSpeechLang("안녕하세요")).toBe("ko-KR");
  });

  it("defaults to English for plain Latin text", () => {
    expect(detectSpeechLang("Hello, world!")).toBe("en-US");
  });
});

describe("isCjk", () => {
  it("is true for Japanese text with kana", () => {
    expect(isCjk("こんにちは")).toBe(true);
  });

  it("is true for kanji+kana mixed Japanese text", () => {
    expect(isCjk("日本語を勉強しています")).toBe(true);
  });

  it("is true for Han-only Chinese text", () => {
    expect(isCjk("你好世界")).toBe(true);
  });

  it("is true for Korean (Hangul) text", () => {
    expect(isCjk("안녕하세요")).toBe(true);
  });

  it("is false for plain English/Latin text", () => {
    expect(isCjk("Hello there, friend.")).toBe(false);
  });
});
