import { describe, it, expect } from "vitest";
import { isMermaidBlock, mermaidSource } from "../mermaidDetect";

describe("isMermaidBlock", () => {
  it("accepts a fenced mermaid block", () => {
    expect(isMermaidBlock("```mermaid\nflowchart TD\n  A --> B\n```")).toBe(true);
  });

  it("accepts leading/trailing whitespace around the fence", () => {
    expect(isMermaidBlock("  \n```mermaid\ngraph TD\n  A --> B\n```\n  ")).toBe(true);
  });

  it("accepts a language tag suffix after mermaid", () => {
    expect(isMermaidBlock("```mermaid live\ngraph TD\n  A --> B\n```")).toBe(true);
  });

  it("rejects a non-mermaid fenced block", () => {
    expect(isMermaidBlock("```js\nconsole.log(1)\n```")).toBe(false);
  });

  it("rejects a fence with no language", () => {
    expect(isMermaidBlock("```\nplain text\n```")).toBe(false);
  });

  it("rejects plain (non-fenced) text", () => {
    expect(isMermaidBlock("just some paragraph text")).toBe(false);
  });

  it("rejects an unterminated mermaid fence", () => {
    expect(isMermaidBlock("```mermaid\nflowchart TD\n  A --> B")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isMermaidBlock("")).toBe(false);
  });
});

describe("mermaidSource", () => {
  it("strips the opening and closing fences", () => {
    expect(mermaidSource("```mermaid\nflowchart TD\n  A --> B\n```")).toBe("flowchart TD\n  A --> B\n");
  });

  it("strips a language tag suffix on the opening fence", () => {
    expect(mermaidSource("```mermaid live\ngraph TD\n  A --> B\n```")).toBe("graph TD\n  A --> B\n");
  });

  it("trims surrounding whitespace before stripping fences", () => {
    expect(mermaidSource("  \n```mermaid\ngraph TD\n```\n  ")).toBe("graph TD\n");
  });

  it("strips trailing whitespace after the closing fence", () => {
    expect(mermaidSource("```mermaid\ngraph TD\n```   ")).toBe("graph TD\n");
  });
});
