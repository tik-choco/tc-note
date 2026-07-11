import { describe, it, expect } from "vitest";
import { INSERT_OPTIONS, resolveScaffold, type Translate } from "../blockScaffolds";
import { translate } from "../i18n";

// Scaffolds are resolved against the Japanese dictionary so expectations
// match the historical (pre-i18n) scaffold text.
const t: Translate = (key, params) => translate("ja", key, params);

function scaffoldFor(key: string): string {
  const option = INSERT_OPTIONS.find((o) => o.key === key);
  if (!option) throw new Error(`no insert option for key "${key}"`);
  return resolveScaffold(option, t);
}

describe("INSERT_OPTIONS scaffolds", () => {
  it("h1/h2/h3 produce ATX heading markers with a trailing space", () => {
    expect(scaffoldFor("h1")).toBe("# ");
    expect(scaffoldFor("h2")).toBe("## ");
    expect(scaffoldFor("h3")).toBe("### ");
  });

  it("bullet produces a dash list marker", () => {
    expect(scaffoldFor("bullet")).toBe("- ");
  });

  it("numbered produces an ordered list marker", () => {
    expect(scaffoldFor("numbered")).toBe("1. ");
  });

  it("checklist produces a GFM task list marker", () => {
    expect(scaffoldFor("checklist")).toBe("- [ ] ");
  });

  it("quote produces a blockquote marker", () => {
    expect(scaffoldFor("quote")).toBe("> ");
  });

  it("code produces an empty fenced code block with cursor line in between", () => {
    expect(scaffoldFor("code")).toBe("```\n\n```");
  });

  it("table produces a valid 2x2 markdown table recognized by isTableMarkdown", () => {
    const scaffold = scaffoldFor("table");
    expect(scaffold).toBe("| 列1 | 列2 |\n| --- | --- |\n|  |  |");
  });

  it("mermaid produces a fenced mermaid flowchart recognized by isMermaidBlock", () => {
    const scaffold = scaffoldFor("mermaid");
    expect(scaffold.startsWith("```mermaid\n")).toBe(true);
    expect(scaffold.endsWith("```")).toBe(true);
  });

  it("hr produces a thematic break", () => {
    expect(scaffoldFor("hr")).toBe("---");
  });

  it("headings/lists/quotes/code are focus:true; table/mermaid/hr are focus:false", () => {
    const focusTrueKeys = ["h1", "h2", "h3", "bullet", "numbered", "checklist", "quote", "code"];
    const focusFalseKeys = ["table", "mermaid", "hr"];
    for (const key of focusTrueKeys) {
      expect(INSERT_OPTIONS.find((o) => o.key === key)?.focus).toBe(true);
    }
    for (const key of focusFalseKeys) {
      expect(INSERT_OPTIONS.find((o) => o.key === key)?.focus).toBe(false);
    }
  });

  it("every option has a unique key and a label in both languages", () => {
    const keys = INSERT_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of INSERT_OPTIONS) {
      expect(translate("ja", option.labelKey).length).toBeGreaterThan(0);
      expect(translate("en", option.labelKey).length).toBeGreaterThan(0);
    }
  });
});
