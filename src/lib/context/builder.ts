import { chunksCollection } from "@/lib/db/collections";
import type { StoredChunk } from "@/lib/db/schemas";
import type { RetrievedChunk } from "@/lib/retrieval/retriever";
import { estimateTokens } from "./tokens";

export interface ContextPassage {
  sourceId: string;
  chunkIds: string[];
  documentId: string;
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  tokens: number;
  score: number;
  expanded: boolean;
}

export interface BuiltContext {
  passages: ContextPassage[];
  totalTokens: number;
  budgetTokens: number;
  droppedChunkIds: string[];
}

export interface ContextOptions {
  maxTokens: number;
  expandSectionMaxTokens?: number;
}

const NEAR_DUPLICATE_THRESHOLD = 0.7;
const SHINGLE_SIZE = 5;
const EXPANSION_FRACTION = 0.35;

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++)
    set.add(words.slice(i, i + SHINGLE_SIZE).join(" "));
  if (set.size === 0 && words.length > 0) set.add(words.join(" "));
  return set;
}

export function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / Math.min(a.size, b.size);
}

function mergeChunkTexts(chunks: StoredChunk[]): string {
  const ordered = [...chunks].sort((a, b) => a.order - b.order);
  return ordered.map((c) => c.text).join("\n\n");
}

function groupBySection(retrieved: RetrievedChunk[]) {
  const groups = new Map<string, RetrievedChunk[]>();
  for (const item of retrieved) {
    const list = groups.get(item.chunk.sectionId) ?? [];
    list.push(item);
    groups.set(item.chunk.sectionId, list);
  }
  return groups;
}

async function loadSectionChunks(documentId: string, sectionId: string): Promise<StoredChunk[]> {
  const collection = await chunksCollection();
  return collection
    .find({ documentId, sectionId }, { projection: { embedding: 0 } })
    .sort({ order: 1 })
    .toArray();
}

type Candidate = Omit<ContextPassage, "sourceId">;

function toCandidates(chunks: StoredChunk[], score: number, expanded: boolean): Candidate[] {
  const ordered = [...chunks].sort((a, b) => a.order - b.order);
  const runs: StoredChunk[][] = [];
  for (const chunk of ordered) {
    const run = runs[runs.length - 1];
    if (run && chunk.order - (run[run.length - 1]?.order ?? -2) === 1) run.push(chunk);
    else runs.push([chunk]);
  }
  return runs.flatMap((run): Candidate[] => {
    const head = run[0];
    if (!head) return [];
    const text = mergeChunkTexts(run);
    return [
      {
        chunkIds: run.map((c) => c._id),
        documentId: head.documentId,
        chapterTitle: head.chapterTitle,
        sectionTitle: head.sectionTitle,
        subsectionTitle: head.subsectionTitle,
        pageStart: Math.min(...run.map((c) => c.pageStart)),
        pageEnd: Math.max(...run.map((c) => c.pageEnd)),
        text,
        tokens: estimateTokens(text),
        score,
        expanded,
      },
    ];
  });
}

interface SectionGroup {
  score: number;
  preferred: Candidate[];
  fallback: Candidate[];
}

async function buildGroups(
  retrieved: RetrievedChunk[],
  expandLimit: number,
): Promise<SectionGroup[]> {
  const groups: SectionGroup[] = [];
  for (const [sectionId, hits] of groupBySection(retrieved)) {
    const first = hits[0];
    if (!first) continue;
    const score = Math.max(...hits.map((h) => h.fusedScore));
    const hitChunks = hits.map((h) => h.chunk);
    const base = toCandidates(hitChunks, score, false);
    let preferred = base;

    if (hits.length >= 2 && first.chunk.kind === "text") {
      const siblings = await loadSectionChunks(first.chunk.documentId, sectionId);
      const sectionTokens = siblings.reduce((n, c) => n + c.tokenCount, 0);
      const hitTokens = hitChunks.reduce((n, c) => n + c.tokenCount, 0);
      if (
        siblings.length > hitChunks.length &&
        sectionTokens <= expandLimit &&
        sectionTokens > hitTokens
      ) {
        preferred = toCandidates(siblings, score, true);
      }
    }
    groups.push({ score, preferred, fallback: base });
  }
  return groups.sort((a, b) => b.score - a.score);
}

export async function buildContext(
  retrieved: RetrievedChunk[],
  options: ContextOptions,
): Promise<BuiltContext> {
  const expandLimit =
    options.expandSectionMaxTokens ?? Math.floor(options.maxTokens * EXPANSION_FRACTION);
  const groups = await buildGroups(retrieved, expandLimit);

  const selected: Candidate[] = [];
  const selectedShingles: Set<string>[] = [];
  const dropped: string[] = [];
  let used = 0;

  const tryAdd = (candidate: Candidate): boolean => {
    const signature = shingles(candidate.text);
    const duplicate = selectedShingles.some(
      (s) => overlapRatio(signature, s) >= NEAR_DUPLICATE_THRESHOLD,
    );
    if (duplicate || used + candidate.tokens > options.maxTokens) return false;
    selected.push(candidate);
    selectedShingles.push(signature);
    used += candidate.tokens;
    return true;
  };

  for (const group of groups) {
    const preferredTokens = group.preferred.reduce((n, c) => n + c.tokens, 0);
    const useFallback = used + preferredTokens > options.maxTokens;
    for (const candidate of useFallback ? group.fallback : group.preferred) {
      if (!tryAdd(candidate)) dropped.push(...candidate.chunkIds);
    }
  }

  selected.sort(
    (a, b) => a.pageStart - b.pageStart || (a.chunkIds[0] ?? "").localeCompare(b.chunkIds[0] ?? ""),
  );
  const passages = selected.map((p, index) => ({ ...p, sourceId: `S${index + 1}` }));
  return { passages, totalTokens: used, budgetTokens: options.maxTokens, droppedChunkIds: dropped };
}
