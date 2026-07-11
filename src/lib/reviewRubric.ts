// "Review" mode: an LLM-judge that scores the active note against one of a
// handful of swappable rubrics (research paper, blog/article, technical
// docs, general writing). Each rubric is a small, self-contained data
// structure — a reviewer framing plus a fixed list of criteria — rather than
// a plugin system, since the set of rubrics is small and fixed.
//
// Deliberately does not import the i18n module: this file only deals in
// plain string ids, so the UI layer (ReviewPanel) owns mapping a rubric/
// criterion id to a localized label. That keeps prompt text (always sent in
// a fixed, precise wording regardless of UI language) decoupled from display
// text.
import type { ChatMessage } from "@tik-choco/mistai";

export interface RubricCriterionScore {
  id: string;
  score: number;
  comment: string;
}

export interface RubricResult {
  criteria: RubricCriterionScore[];
  overallScore: number;
  summary: string;
}

export interface RubricCriterionDef {
  id: string;
  /** One-line definition handed to the model verbatim, in English — prompt
   * wording is fixed regardless of UI language; only the model's output
   * (comments/summary) is localized via the `language` param. */
  definition: string;
}

export interface Rubric {
  /** Stable id, used as the localStorage/select value and as a lookup key. */
  id: string;
  criteria: RubricCriterionDef[];
  /** The "You are a strict, expert ..." framing sentence for this rubric,
   * handed to the model verbatim as the first line of the system prompt. */
  reviewerRole: string;
}

// The rubric this feature originally shipped with — scores the note as a
// research-paper draft.
export const RESEARCH_RUBRIC: Rubric = {
  id: "research",
  reviewerRole: "You are a strict, expert academic peer reviewer.",
  criteria: [
    {
      id: "technicalContent",
      definition:
        "Technical Content — validity of the methods, implementation, and experiments; technical correctness and depth.",
    },
    {
      id: "originality",
      definition:
        "Originality — novelty of the work, differentiation from existing work, and uniqueness of the ideas.",
    },
    {
      id: "clarity",
      definition: "Clarity — how clear the writing is, and clarity of structure and logical flow.",
    },
    {
      id: "significance",
      definition:
        "Significance — importance of the research, its contribution to the field, and potential impact.",
    },
    {
      id: "presentationStyle",
      definition:
        "Presentation Style — quality of figures, writing, and formatting; also explicitly comment on textual " +
        "consistency and coherence between sentences, and overall polish.",
    },
  ],
};

// Scores the note as a blog post / article draft.
export const ARTICLE_RUBRIC: Rubric = {
  id: "article",
  reviewerRole: "You are a strict, expert editor reviewing blog posts and articles for a general audience.",
  criteria: [
    {
      id: "hookEngagement",
      definition:
        "Hook & Engagement — how compelling the opening is, and whether the piece holds the reader's interest throughout.",
    },
    {
      id: "clarity",
      definition: "Clarity — how clear and easy to follow the writing is.",
    },
    {
      id: "structure",
      definition: "Structure — logical organization, pacing, and flow from section to section.",
    },
    {
      id: "accuracySupport",
      definition: "Accuracy & Support — factual accuracy, and whether claims are backed by evidence or examples.",
    },
    {
      id: "style",
      definition: "Style — voice, tone, word choice, and overall polish of the prose.",
    },
  ],
};

// Scores the note as technical documentation.
export const DOCS_RUBRIC: Rubric = {
  id: "docs",
  reviewerRole: "You are a strict, expert technical documentation reviewer.",
  criteria: [
    {
      id: "accuracy",
      definition: "Accuracy — technical correctness of every statement, command, and code sample.",
    },
    {
      id: "completeness",
      definition: "Completeness — whether prerequisites, edge cases, and necessary steps are all covered.",
    },
    {
      id: "clarity",
      definition: "Clarity — how clear and unambiguous the explanations are for the intended audience.",
    },
    {
      id: "structure",
      definition:
        "Structure & Navigability — logical organization, headings, and how easily a reader can find what they need.",
    },
    {
      id: "examples",
      definition: "Examples — quality, correctness, and usefulness of examples and code snippets.",
    },
  ],
};

// Scores the note as general writing (notes, emails, essays — anything that
// isn't a paper, article, or technical doc).
export const GENERAL_RUBRIC: Rubric = {
  id: "general",
  reviewerRole: "You are a strict, expert writing editor.",
  criteria: [
    {
      id: "clarity",
      definition: "Clarity — how clear and easy to understand the writing is.",
    },
    {
      id: "structure",
      definition: "Structure — logical organization and flow of ideas.",
    },
    {
      id: "coherence",
      definition: "Coherence — how well ideas connect and build on one another, sentence to sentence.",
    },
    {
      id: "tone",
      definition: "Tone — appropriateness and consistency of tone for the apparent purpose and audience.",
    },
    {
      id: "polish",
      definition: "Polish — grammar, wording, and overall attention to detail.",
    },
  ],
};

export const RUBRICS: Rubric[] = [RESEARCH_RUBRIC, ARTICLE_RUBRIC, DOCS_RUBRIC, GENERAL_RUBRIC];

export const DEFAULT_RUBRIC_ID = RESEARCH_RUBRIC.id;

export function getRubricById(id: string | null | undefined): Rubric {
  return RUBRICS.find((r) => r.id === id) ?? RESEARCH_RUBRIC;
}

function buildResponseShape(rubric: Rubric): string {
  const criteriaShape = rubric.criteria.map((c) => `"${c.id}":{"score":number,"comment":string}`).join(",");
  return `{${criteriaShape},"overallScore":number,"summary":string}`;
}

// Builds the two-message chat payload sent to net.send() to run a review.
// `language` is the app's current UI language (e.g. "ja", "en") — the model
// is instructed to write its comments/summary in it.
export function buildReviewPrompt(params: {
  rubric: Rubric;
  title: string;
  content: string;
  language: string;
}): ChatMessage[] {
  const { rubric, title, content, language } = params;

  const criteriaList = rubric.criteria.map((c, i) => `${i + 1}. ${c.definition}`).join("\n");

  const system = [
    rubric.reviewerRole,
    `Evaluate the text given by the user, on exactly these ${rubric.criteria.length} criteria:`,
    criteriaList,
    "Score each criterion from 1 to 10 (1 = very poor, 10 = exceptional).",
    `Write every "comment" and the "summary" in the following language: ${language}.`,
    "Respond with ONLY raw JSON — no markdown code fences, no prose before or after — matching exactly this shape:",
    buildResponseShape(rubric),
  ].join("\n\n");

  const trimmedTitle = title.trim();
  const userContent = trimmedTitle ? `# ${trimmedTitle}\n\n${content}` : content;

  return [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function clampScore(value: unknown, fieldName: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`Review response's "${fieldName}" must be a number.`);
  }
  if (!Number.isFinite(n)) {
    throw new Error(`Review response's "${fieldName}" is not a finite number.`);
  }
  return Math.min(10, Math.max(1, n));
}

// Strips an optional ```json fence, parses, validates every criterion in
// `rubric` + overallScore + summary, and clamps every score into [1, 10].
// Throws a descriptive Error on any malformed shape so the UI can show a
// recoverable error state (with the raw text available) instead of crashing.
export function parseReviewResponse(raw: string, rubric: Rubric): RubricResult {
  const cleaned = stripCodeFence(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse the review response as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Review response is not a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;

  const criteria: RubricCriterionScore[] = [];
  for (const def of rubric.criteria) {
    const entry = obj[def.id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Review response is missing the "${def.id}" criterion.`);
    }
    const entryObj = entry as Record<string, unknown>;
    if (typeof entryObj.comment !== "string") {
      throw new Error(`Review response's "${def.id}" criterion is missing a string "comment".`);
    }
    criteria.push({
      id: def.id,
      score: clampScore(entryObj.score, `${def.id}.score`),
      comment: entryObj.comment,
    });
  }

  if (typeof obj.summary !== "string") {
    throw new Error('Review response is missing a string "summary".');
  }

  return {
    criteria,
    overallScore: clampScore(obj.overallScore, "overallScore"),
    summary: obj.summary,
  };
}
