import { chunksCollection, postingsCollection, statsCollection } from "@/lib/db/collections";
import type { DraftChunk, PostingRecord } from "@/lib/db/schemas";
import { buildSearchText, extractQuotedPhrases, normalizeForPhrase, tokenize } from "./tokenizer";

export const BM25_K1 = 1.4;
export const BM25_B = 0.75;
const PHRASE_BOOST = 1.5;
const INSERT_BATCH = 2000;

export interface ScoredChunk {
  chunkId: string;
  score: number;
}

export function buildPostings(documentId: string, chunks: DraftChunk[]) {
  const terms = new Map<string, { chunkId: string; tf: number }[]>();
  const lengths: Record<string, number> = {};
  for (const chunk of chunks) {
    const tokens = tokenize(buildSearchText(chunk));
    lengths[chunk._id] = tokens.length;
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const [term, tf] of frequencies) {
      const list = terms.get(term) ?? [];
      list.push({ chunkId: chunk._id, tf });
      terms.set(term, list);
    }
  }
  const postings: PostingRecord[] = [...terms].map(([term, list]) => ({
    _id: `${documentId}:${term}`,
    documentId,
    term,
    df: list.length,
    postings: list,
  }));
  const total = Object.values(lengths).reduce((a, b) => a + b, 0);
  const stats = {
    _id: documentId,
    chunkCount: chunks.length,
    averageLength: chunks.length > 0 ? total / chunks.length : 0,
    lengths,
  };
  return { postings, stats };
}

export async function replaceBm25Index(documentId: string, chunks: DraftChunk[]) {
  const [postingsCol, statsCol] = await Promise.all([postingsCollection(), statsCollection()]);
  const { postings, stats } = buildPostings(documentId, chunks);
  await Promise.all([
    postingsCol.deleteMany({ documentId }),
    statsCol.deleteOne({ _id: documentId }),
  ]);
  for (let i = 0; i < postings.length; i += INSERT_BATCH) {
    await postingsCol.insertMany(postings.slice(i, i + INSERT_BATCH), { ordered: false });
  }
  await statsCol.insertOne(stats);
}

export async function deleteBm25Index(documentId: string) {
  const [postingsCol, statsCol] = await Promise.all([postingsCollection(), statsCollection()]);
  await Promise.all([
    postingsCol.deleteMany({ documentId }),
    statsCol.deleteOne({ _id: documentId }),
  ]);
}

export function scoreBm25(
  postings: Pick<PostingRecord, "df" | "postings">[],
  stats: { chunkCount: number; averageLength: number; lengths: Record<string, number> },
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const entry of postings) {
    const idf = Math.log(1 + (stats.chunkCount - entry.df + 0.5) / (entry.df + 0.5));
    for (const { chunkId, tf } of entry.postings) {
      const length = stats.lengths[chunkId] ?? stats.averageLength;
      const norm = 1 - BM25_B + BM25_B * (length / (stats.averageLength || 1));
      const contribution = idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm));
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + contribution);
    }
  }
  return scores;
}

export async function keywordSearch(
  documentId: string,
  query: string,
  limit: number,
): Promise<ScoredChunk[]> {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const [postingsCol, statsCol] = await Promise.all([postingsCollection(), statsCollection()]);
  const [stats, postings] = await Promise.all([
    statsCol.findOne({ _id: documentId }),
    postingsCol.find({ documentId, term: { $in: terms } }).toArray(),
  ]);
  if (!stats || postings.length === 0) return [];

  const scores = scoreBm25(postings, stats);
  let ranked = [...scores]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3);

  const phrases = extractQuotedPhrases(query).map(normalizeForPhrase);
  if (phrases.length > 0) {
    const chunks = await chunksCollection();
    const docs = await chunks
      .find({ _id: { $in: ranked.map((r) => r.chunkId) } }, { projection: { text: 1 } })
      .toArray();
    const texts = new Map(docs.map((d) => [d._id, normalizeForPhrase(d.text)]));
    ranked = ranked
      .map((r) => {
        const text = texts.get(r.chunkId) ?? "";
        return phrases.every((p) => text.includes(p)) ? { ...r, score: r.score * PHRASE_BOOST } : r;
      })
      .sort((a, b) => b.score - a.score);
  }
  return ranked.slice(0, limit);
}
