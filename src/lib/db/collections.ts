import type { Collection } from "mongodb";
import { getDb } from "./mongo";
import type {
  Bm25StatsRecord,
  ChunkRecord,
  DocumentRecord,
  EvalRunRecord,
  PostingRecord,
  SectionRecord,
} from "./schemas";

export const COLLECTIONS = {
  documents: "documents",
  sections: "sections",
  chunks: "chunks",
  postings: "bm25_postings",
  stats: "bm25_stats",
  evalRuns: "eval_runs",
} as const;

export async function documentsCollection(): Promise<Collection<DocumentRecord>> {
  return (await getDb()).collection<DocumentRecord>(COLLECTIONS.documents);
}

export async function sectionsCollection(): Promise<Collection<SectionRecord>> {
  return (await getDb()).collection<SectionRecord>(COLLECTIONS.sections);
}

export async function chunksCollection(): Promise<Collection<ChunkRecord>> {
  return (await getDb()).collection<ChunkRecord>(COLLECTIONS.chunks);
}

export async function postingsCollection(): Promise<Collection<PostingRecord>> {
  return (await getDb()).collection<PostingRecord>(COLLECTIONS.postings);
}

export async function statsCollection(): Promise<Collection<Bm25StatsRecord>> {
  return (await getDb()).collection<Bm25StatsRecord>(COLLECTIONS.stats);
}

export async function evalRunsCollection(): Promise<Collection<EvalRunRecord>> {
  return (await getDb()).collection<EvalRunRecord>(COLLECTIONS.evalRuns);
}
