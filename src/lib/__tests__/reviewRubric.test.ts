import { describe, it, expect } from "vitest";
import {
  buildReviewPrompt,
  parseReviewResponse,
  getRubricById,
  RUBRICS,
  RESEARCH_RUBRIC,
  ARTICLE_RUBRIC,
  DOCS_RUBRIC,
  GENERAL_RUBRIC,
  DEFAULT_RUBRIC_ID,
} from "../reviewRubric";

describe("RUBRICS", () => {
  it("ships exactly the 4 expected presets, each with a unique id", () => {
    expect(RUBRICS.map((r) => r.id)).toEqual(["research", "article", "docs", "general"]);
  });

  it("gives every rubric a non-empty reviewer role and at least one criterion", () => {
    for (const rubric of RUBRICS) {
      expect(rubric.reviewerRole.length).toBeGreaterThan(0);
      expect(rubric.criteria.length).toBeGreaterThan(0);
      for (const c of rubric.criteria) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(c.definition.length).toBeGreaterThan(0);
      }
    }
  });

  it("defaults to the research rubric", () => {
    expect(DEFAULT_RUBRIC_ID).toBe("research");
  });
});

describe("getRubricById", () => {
  it("looks up each shipped rubric by id", () => {
    expect(getRubricById("research")).toBe(RESEARCH_RUBRIC);
    expect(getRubricById("article")).toBe(ARTICLE_RUBRIC);
    expect(getRubricById("docs")).toBe(DOCS_RUBRIC);
    expect(getRubricById("general")).toBe(GENERAL_RUBRIC);
  });

  it("falls back to the research rubric for an unknown or missing id", () => {
    expect(getRubricById("nonsense")).toBe(RESEARCH_RUBRIC);
    expect(getRubricById(undefined)).toBe(RESEARCH_RUBRIC);
    expect(getRubricById(null)).toBe(RESEARCH_RUBRIC);
  });
});

describe("RESEARCH_RUBRIC", () => {
  it("has exactly the 5 expected criterion ids, in order", () => {
    expect(RESEARCH_RUBRIC.criteria.map((c) => c.id)).toEqual([
      "technicalContent",
      "originality",
      "clarity",
      "significance",
      "presentationStyle",
    ]);
  });
});

describe("buildReviewPrompt", () => {
  it("mentions all five research criteria and the reviewer framing in the system message", () => {
    const messages = buildReviewPrompt({
      rubric: RESEARCH_RUBRIC,
      title: "My Paper",
      content: "Some body text.",
      language: "en",
    });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("academic peer reviewer");
    expect(system).toContain("Technical Content");
    expect(system).toContain("Originality");
    expect(system).toContain("Clarity");
    expect(system).toContain("Significance");
    expect(system).toContain("Presentation Style");
  });

  it("builds a prompt for a non-research rubric (docs) with its own framing and criteria", () => {
    const messages = buildReviewPrompt({
      rubric: DOCS_RUBRIC,
      title: "Getting started",
      content: "Install the CLI, then run `init`.",
      language: "en",
    });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("technical documentation reviewer");
    expect(system).toContain("Accuracy");
    expect(system).toContain("Completeness");
    expect(system).toContain("Structure & Navigability");
    expect(system).toContain("Examples");
    // The response shape should key on the docs criterion ids, not research's.
    expect(system).toContain('"accuracy":{"score":number,"comment":string}');
    expect(system).not.toContain("technicalContent");
  });

  it("includes the requested output language in the system message", () => {
    const messages = buildReviewPrompt({ rubric: RESEARCH_RUBRIC, title: "T", content: "C", language: "ja" });
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("ja");
  });

  it("puts the title and content in the user message", () => {
    const messages = buildReviewPrompt({
      rubric: RESEARCH_RUBRIC,
      title: "My Paper",
      content: "Some body text.",
      language: "en",
    });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("My Paper");
    expect(user).toContain("Some body text.");
  });

  it("omits the title heading when the title is blank", () => {
    const messages = buildReviewPrompt({ rubric: RESEARCH_RUBRIC, title: "   ", content: "Body only.", language: "en" });
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toBe("Body only.");
  });
});

describe("parseReviewResponse", () => {
  const VALID = {
    technicalContent: { score: 8, comment: "Solid methods." },
    originality: { score: 6, comment: "Some novelty." },
    clarity: { score: 7, comment: "Mostly clear." },
    significance: { score: 5, comment: "Modest impact." },
    presentationStyle: { score: 9, comment: "Well formatted." },
    overallScore: 7,
    summary: "A decent draft overall.",
  };

  it("parses plain JSON", () => {
    const result = parseReviewResponse(JSON.stringify(VALID), RESEARCH_RUBRIC);
    expect(result.overallScore).toBe(7);
    expect(result.summary).toBe("A decent draft overall.");
    expect(result.criteria).toHaveLength(5);
    expect(result.criteria.find((c) => c.id === "technicalContent")).toEqual({
      id: "technicalContent",
      score: 8,
      comment: "Solid methods.",
    });
  });

  it("strips a ```json fence", () => {
    const raw = "```json\n" + JSON.stringify(VALID) + "\n```";
    const result = parseReviewResponse(raw, RESEARCH_RUBRIC);
    expect(result.overallScore).toBe(7);
    expect(result.criteria).toHaveLength(5);
  });

  it("strips a bare ``` fence", () => {
    const raw = "```\n" + JSON.stringify(VALID) + "\n```";
    const result = parseReviewResponse(raw, RESEARCH_RUBRIC);
    expect(result.criteria).toHaveLength(5);
  });

  it("throws a descriptive error when a criterion is missing", () => {
    const { clarity: _clarity, ...rest } = VALID;
    expect(() => parseReviewResponse(JSON.stringify(rest), RESEARCH_RUBRIC)).toThrow(/clarity/i);
  });

  it("throws when summary is missing", () => {
    const { summary: _summary, ...rest } = VALID;
    expect(() => parseReviewResponse(JSON.stringify(rest), RESEARCH_RUBRIC)).toThrow(/summary/i);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseReviewResponse("not json at all", RESEARCH_RUBRIC)).toThrow();
  });

  it("throws on non-object JSON", () => {
    expect(() => parseReviewResponse("[1,2,3]", RESEARCH_RUBRIC)).toThrow();
  });

  it("clamps an out-of-range score into [1, 10]", () => {
    const skewed = {
      ...VALID,
      technicalContent: { score: 15, comment: "x" },
      originality: { score: -3, comment: "y" },
      overallScore: 0,
    };
    const result = parseReviewResponse(JSON.stringify(skewed), RESEARCH_RUBRIC);
    expect(result.criteria.find((c) => c.id === "technicalContent")?.score).toBe(10);
    expect(result.criteria.find((c) => c.id === "originality")?.score).toBe(1);
    expect(result.overallScore).toBe(1);
  });

  it("parses a response for a non-research rubric (general)", () => {
    const generalValid = {
      clarity: { score: 8, comment: "Clear." },
      structure: { score: 6, comment: "Mostly organized." },
      coherence: { score: 7, comment: "Flows well." },
      tone: { score: 9, comment: "Consistent." },
      polish: { score: 5, comment: "A few typos." },
      overallScore: 7,
      summary: "Solid general writing.",
    };
    const result = parseReviewResponse(JSON.stringify(generalValid), GENERAL_RUBRIC);
    expect(result.criteria.map((c) => c.id)).toEqual(["clarity", "structure", "coherence", "tone", "polish"]);
    expect(result.overallScore).toBe(7);
  });

  it("throws when validating against the wrong rubric's criteria", () => {
    // VALID happens to include a "clarity" entry (shared with GENERAL_RUBRIC),
    // but is missing "structure", which GENERAL_RUBRIC requires next.
    expect(() => parseReviewResponse(JSON.stringify(VALID), GENERAL_RUBRIC)).toThrow(/structure/i);
  });
});
