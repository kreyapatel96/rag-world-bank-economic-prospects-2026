export interface PageRange {
  pageStart: number;
  pageEnd: number;
}

export function overlapsRelevantPages(range: PageRange, relevantPages: number[]): boolean {
  return relevantPages.some((page) => page >= range.pageStart && page <= range.pageEnd);
}

export interface RetrievalMetrics {
  hit: boolean;
  recall: number;
  precision: number;
  reciprocalRank: number;
}

export function retrievalMetrics(
  retrieved: PageRange[],
  relevantPages: number[],
  k: number,
): RetrievalMetrics {
  const top = retrieved.slice(0, k);
  const flags = top.map((range) => overlapsRelevantPages(range, relevantPages));
  const firstRelevant = flags.indexOf(true);
  const covered = relevantPages.filter((page) =>
    top.some((range) => page >= range.pageStart && page <= range.pageEnd),
  ).length;
  return {
    hit: firstRelevant >= 0,
    recall: relevantPages.length > 0 ? covered / relevantPages.length : 0,
    precision: top.length > 0 ? flags.filter(Boolean).length / top.length : 0,
    reciprocalRank: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
  };
}

export function citationAccuracy(citations: PageRange[], relevantPages: number[]): number | null {
  if (citations.length === 0) return null;
  return citations.filter((c) => overlapsRelevantPages(c, relevantPages)).length / citations.length;
}

export function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
