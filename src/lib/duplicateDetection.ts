// Free, non-LLM duplicate/near-duplicate sentence check for "Research
// Review" mode's consistency section. Deterministic and DOM-free so it's
// unit-testable directly: split note blocks into sentences, then flag pairs
// that are exact or near-exact matches using bigram-Jaccard similarity (no
// tokenizer needed, works for both Latin and CJK text).

export interface SentenceMatch {
  a: { blockIndex: number; sentence: string };
  b: { blockIndex: number; sentence: string };
  similarity: number;
}

interface SentenceRef {
  blockIndex: number;
  sentenceIndex: number;
  original: string;
  normalized: string;
}

const DEFAULT_MIN_LENGTH = 8;
const DEFAULT_THRESHOLD = 0.82;

// Comparing every sentence pair is O(n^2). Capping the pool at 800 sentences
// bounds that at ~320k comparisons (each a cheap bigram-set intersection),
// which stays fast even for a very large note, while comfortably covering a
// realistic paper-length draft.
const MAX_SENTENCES = 800;

// Best-effort skip for blocks whose content shouldn't be sentence-scanned:
// fenced code, display math, and table/mermaid blocks. Perfect fence-
// awareness isn't the goal here (splitBlocks already keeps fences whole) —
// this just keeps obviously-non-prose blocks out of the comparison pool.
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function isSkippableBlock(block: string): boolean {
  const trimmed = block.trim();
  if (trimmed.startsWith("```")) return true; // fenced code (incl. ```mermaid)
  if (trimmed.startsWith("$$")) return true; // display-math fence
  const lines = trimmed.split("\n");
  if (lines.length >= 2 && TABLE_DELIMITER_RE.test(lines[1])) return true; // GFM table
  return false;
}

// Splits on `.`, `!`, `?`, and their fullwidth CJK forms (`。`, `．`, `！`,
// `？`) when followed by whitespace or end-of-string — CJK sentences usually
// have no space after the terminator otherwise, so we can't just split on
// every occurrence of the punctuation.
const TERMINATORS = new Set([".", "!", "?", "。", "．", "！", "？"]);

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    current += ch;
    if (TERMINATORS.has(ch)) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        sentences.push(current);
        current = "";
      }
    }
  }
  if (current.trim()) sentences.push(current);
  return sentences;
}

// Trim, collapse internal whitespace, lowercase (a safe no-op for CJK).
function normalize(sentence: string): string {
  return sentence.trim().replace(/\s+/g, " ").toLowerCase();
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length < 2) {
    if (s.length === 1) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// Jaccard similarity over character bigrams — no tokenizer required, so it
// works equally for space-delimited Latin text and unsegmented CJK text.
function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Finds duplicate/near-duplicate sentences across (or within) the given
// blocks. `blocks` is expected to be the output of splitBlocks(noteText).
export function findDuplicateSentences(
  blocks: string[],
  options?: { minLength?: number; threshold?: number },
): SentenceMatch[] {
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  const refs: SentenceRef[] = [];
  blocks.forEach((block, blockIndex) => {
    if (isSkippableBlock(block)) return;
    const sentences = splitSentences(block);
    sentences.forEach((sentence, sentenceIndex) => {
      const normalized = normalize(sentence);
      if (normalized.length < minLength) return;
      refs.push({ blockIndex, sentenceIndex, original: sentence.trim(), normalized });
    });
  });

  const pool = refs.slice(0, MAX_SENTENCES);

  const matches: SentenceMatch[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      // Never flag a sentence against itself / the same position.
      if (a.blockIndex === b.blockIndex && a.sentenceIndex === b.sentenceIndex) continue;
      const similarity = jaccardSimilarity(a.normalized, b.normalized);
      if (similarity >= threshold) {
        matches.push({
          a: { blockIndex: a.blockIndex, sentence: a.original },
          b: { blockIndex: b.blockIndex, sentence: b.original },
          similarity,
        });
      }
    }
  }
  return matches;
}
