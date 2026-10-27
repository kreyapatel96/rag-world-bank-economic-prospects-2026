import { tokenize } from "@/lib/retrieval/tokenizer";

export const CHUNKING_STRATEGIES = [
  "hierarchical",
  "paragraph",
  "sentence_window",
  "topic_shift",
] as const;
export type ChunkingStrategy = (typeof CHUNKING_STRATEGIES)[number];

export function isChunkingStrategy(value: unknown): value is ChunkingStrategy {
  return typeof value === "string" && (CHUNKING_STRATEGIES as readonly string[]).includes(value);
}

export interface Unit {
  text: string;
  page: number;
  paragraphStart: boolean;
  tokens: number;
}

export interface PackingOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
  windowSentences: number;
}

export const STRATEGY_DESCRIPTIONS: Record<ChunkingStrategy, string> = {
  hierarchical:
    "Packs whole sentences up to the target size inside each section, with sentence-level overlap.",
  paragraph:
    "One chunk per paragraph; tiny paragraphs are merged forward, oversized ones are split at sentence boundaries.",
  sentence_window:
    "Sliding windows of N consecutive sentences with half-window stride. Small, precise chunks.",
  topic_shift:
    "Starts a new chunk where the vocabulary of the surrounding sentences changes most, within the size limits.",
};

// Every strategy works on whole sentences, so a chunk never starts or ends mid-sentence.
export function packHierarchical(units: Unit[], options: PackingOptions): Unit[][] {
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let tokens = 0;

  const startNext = (previous: Unit[]) => {
    const overlap: Unit[] = [];
    let used = 0;
    for (let i = previous.length - 1; i > 0; i--) {
      const unit = previous[i];
      if (!unit || used + unit.tokens > options.overlapTokens) break;
      overlap.unshift(unit);
      used += unit.tokens;
    }
    current = overlap;
    tokens = used;
  };

  // A paragraph is kept whole unless it cannot fit in a chunk by itself.
  const paragraphTokens = new Map<Unit, number>();
  for (const paragraph of splitParagraphs(units)) {
    const first = paragraph[0];
    if (first) paragraphTokens.set(first, sumTokens(paragraph));
  }

  for (const unit of units) {
    const wholeParagraph = paragraphTokens.get(unit);
    const paragraphFits = wholeParagraph !== undefined && wholeParagraph <= options.targetTokens;
    const wouldOverflow = tokens + unit.tokens > options.targetTokens;
    const startsParagraphThatNoLongerFits =
      paragraphFits &&
      tokens + wholeParagraph > options.targetTokens &&
      tokens >= options.targetTokens * 0.4;
    const endsNaturally = unit.paragraphStart && tokens >= options.targetTokens * 0.7;
    if (current.length > 0 && (startsParagraphThatNoLongerFits || endsNaturally || wouldOverflow)) {
      groups.push(current);
      startNext(current);
    }
    current.push(unit);
    tokens += unit.tokens;
  }
  const lastGroup = groups[groups.length - 1];
  const onlyOverlap = lastGroup !== undefined && current.every((u) => lastGroup.includes(u));
  if (current.length > 0 && !onlyOverlap) groups.push(current);
  return groups;
}

function splitParagraphs(units: Unit[]): Unit[][] {
  const paragraphs: Unit[][] = [];
  for (const unit of units) {
    const last = paragraphs[paragraphs.length - 1];
    if (!last || unit.paragraphStart) paragraphs.push([unit]);
    else last.push(unit);
  }
  return paragraphs;
}

const sumTokens = (units: Unit[]) => units.reduce((n, u) => n + u.tokens, 0);

export function packParagraphs(units: Unit[], options: PackingOptions): Unit[][] {
  const minTokens = options.targetTokens * 0.25;
  const groups: Unit[][] = [];
  let carry: Unit[] = [];

  const emit = (group: Unit[]) => {
    const first = group[0];
    if (first) groups.push(group.map((u, i) => (i === 0 ? { ...u, paragraphStart: true } : u)));
  };

  for (const paragraph of splitParagraphs(units)) {
    const merged = [...carry, ...paragraph];
    const tokens = sumTokens(merged);
    if (tokens > options.targetTokens * 1.5) {
      if (carry.length > 0) emit(carry);
      carry = [];
      const pieces = packHierarchical(paragraph, { ...options, overlapTokens: 0 });
      pieces.forEach(emit);
    } else if (tokens < minTokens) {
      carry = merged;
    } else {
      emit(merged);
      carry = [];
    }
  }
  if (carry.length > 0) emit(carry);
  return groups;
}

export function packSentenceWindows(units: Unit[], options: PackingOptions): Unit[][] {
  const window = Math.max(1, options.windowSentences);
  const stride = Math.max(1, Math.ceil(window / 2));
  const groups: Unit[][] = [];
  let start = 0;
  while (start < units.length) {
    let end = Math.min(units.length, start + window);
    while (end - start > 1 && sumTokens(units.slice(start, end)) > options.maxTokens) end--;
    groups.push(units.slice(start, end));
    if (end >= units.length) break;
    start += Math.min(stride, end - start);
  }
  return groups;
}

type TermCounts = Map<string, number>;

function termCounts(units: Unit[]): TermCounts {
  const counts: TermCounts = new Map();
  for (const unit of units) {
    for (const term of tokenize(unit.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function cosine(a: TermCounts, b: TermCounts): number {
  let dot = 0;
  for (const [term, count] of a) dot += count * (b.get(term) ?? 0);
  const norm = (m: TermCounts) => Math.sqrt([...m.values()].reduce((n, c) => n + c * c, 0));
  const denominator = norm(a) * norm(b);
  return denominator === 0 ? 0 : dot / denominator;
}

const TOPIC_WINDOW = 3;

// similarity[i] compares the sentences before boundary i with those after it.
export function boundarySimilarities(units: Unit[]): number[] {
  const similarities: number[] = [];
  for (let boundary = 1; boundary < units.length; boundary++) {
    const before = termCounts(units.slice(Math.max(0, boundary - TOPIC_WINDOW), boundary));
    const after = termCounts(units.slice(boundary, boundary + TOPIC_WINDOW));
    similarities.push(cosine(before, after));
  }
  return similarities;
}

export function packTopicShift(units: Unit[], options: PackingOptions): Unit[][] {
  if (units.length < 2) return units.length === 0 ? [] : [units];
  const similarities = boundarySimilarities(units);
  const mean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const deviation = Math.sqrt(
    similarities.reduce((n, s) => n + (s - mean) ** 2, 0) / similarities.length,
  );
  const threshold = mean - 0.5 * deviation;
  const isShift = (boundary: number) => {
    const value = similarities[boundary - 1] ?? 1;
    const before = similarities[boundary - 2] ?? Infinity;
    const after = similarities[boundary] ?? Infinity;
    return value < threshold && value <= before && value <= after;
  };

  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let tokens = 0;
  units.forEach((unit, index) => {
    const overflow = tokens + unit.tokens > options.targetTokens;
    const shift = index > 0 && isShift(index) && tokens >= options.targetTokens * 0.4;
    if (current.length > 0 && (overflow || shift)) {
      groups.push(current);
      current = [];
      tokens = 0;
    }
    current.push(unit);
    tokens += unit.tokens;
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

export function packUnits(
  strategy: ChunkingStrategy,
  units: Unit[],
  options: PackingOptions,
): Unit[][] {
  switch (strategy) {
    case "paragraph":
      return packParagraphs(units, options);
    case "sentence_window":
      return packSentenceWindows(units, options);
    case "topic_shift":
      return packTopicShift(units, options);
    default:
      return packHierarchical(units, options);
  }
}
