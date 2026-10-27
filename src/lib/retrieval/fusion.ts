export type RetrievalMethod = "semantic" | "keyword";

export interface RankedList {
  method: RetrievalMethod;
  items: { chunkId: string; score: number }[];
}

export interface FusedResult {
  chunkId: string;
  fusedScore: number;
  contributions: { method: RetrievalMethod; rank: number; score: number }[];
}

export function reciprocalRankFusion(lists: RankedList[], k: number): FusedResult[] {
  const fused = new Map<string, FusedResult>();
  for (const list of lists) {
    list.items.forEach((item, index) => {
      const rank = index + 1;
      const entry = fused.get(item.chunkId) ?? {
        chunkId: item.chunkId,
        fusedScore: 0,
        contributions: [],
      };
      entry.fusedScore += 1 / (k + rank);
      entry.contributions.push({ method: list.method, rank, score: item.score });
      fused.set(item.chunkId, entry);
    });
  }
  return [...fused.values()].sort(
    (a, b) => b.fusedScore - a.fusedScore || a.chunkId.localeCompare(b.chunkId),
  );
}
