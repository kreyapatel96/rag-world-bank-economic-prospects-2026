import { getEnv, ollamaConfig } from "@/lib/config/env";
import { chunksCollection } from "@/lib/db/collections";
import type { DocumentRecord, StoredChunk } from "@/lib/db/schemas";
import { embedTexts } from "@/lib/embeddings/embedder";
import { AppError, errorMessage } from "@/lib/http/errors";
import { keywordSearch } from "./bm25";
import { reciprocalRankFusion, type FusedResult, type RetrievalMethod } from "./fusion";
import { semanticSearch } from "./vector-search";

export interface RetrievedChunk {
  chunk: StoredChunk;
  fusedScore: number;
  method: RetrievalMethod | "hybrid";
  semantic?: { rank: number; score: number };
  keyword?: { rank: number; score: number };
}

export interface RetrievalResult {
  documentId: string;
  query: string;
  chunks: RetrievedChunk[];
  semantic: { used: boolean; reason?: string };
  keyword: { used: boolean };
  latencyMs: number;
}

export interface RetrievalOptions {
  topK: number;
  finalK: number;
  rrfK: number;
}

export function defaultRetrievalOptions(): RetrievalOptions {
  const env = getEnv();
  return { topK: env.RETRIEVAL_TOP_K, finalK: env.RERANK_TOP_K, rrfK: env.RRF_K };
}

function methodOf(result: FusedResult): RetrievedChunk["method"] {
  const methods = new Set(result.contributions.map((c) => c.method));
  if (methods.size > 1) return "hybrid";
  return result.contributions[0]?.method ?? "keyword";
}

async function trySemantic(document: DocumentRecord, query: string, limit: number) {
  const { embeddingModel } = ollamaConfig();
  if (document.embeddingModel !== embeddingModel) {
    return {
      items: [],
      reason: `Document was embedded with "${document.embeddingModel}" but "${embeddingModel}" is configured. Reprocess the document to use semantic search.`,
    };
  }
  try {
    const embedded = await embedTexts([query], "query");
    if (embedded.dimensions !== document.embeddingDimensions) {
      return {
        items: [],
        reason: "Query embedding dimensions do not match the stored embeddings.",
      };
    }
    const queryVector = embedded.vectors[0];
    if (!queryVector) return { items: [], reason: "Query embedding was empty." };
    const items = await semanticSearch({
      documentId: document._id,
      embeddingModel,
      queryVector,
      limit,
    });
    return { items, reason: undefined };
  } catch (error) {
    return { items: [], reason: errorMessage(error) };
  }
}

export async function retrieve(
  document: DocumentRecord,
  query: string,
  options: RetrievalOptions = defaultRetrievalOptions(),
): Promise<RetrievalResult> {
  if (document.status !== "ready") {
    throw AppError.conflict("The document has not finished processing");
  }
  const started = Date.now();
  const [keywordItems, semantic] = await Promise.all([
    keywordSearch(document._id, query, options.topK),
    trySemantic(document, query, options.topK),
  ]);

  const fused = reciprocalRankFusion(
    [
      { method: "semantic", items: semantic.items },
      { method: "keyword", items: keywordItems },
    ],
    options.rrfK,
  ).slice(0, options.finalK);

  const collection = await chunksCollection();
  const records = await collection
    .find({ _id: { $in: fused.map((f) => f.chunkId) } }, { projection: { embedding: 0 } })
    .toArray();
  const byId = new Map(records.map((r) => [r._id, r as StoredChunk]));

  const chunks = fused.flatMap((result): RetrievedChunk[] => {
    const chunk = byId.get(result.chunkId);
    if (!chunk) return [];
    const pick = (method: RetrievalMethod) => {
      const found = result.contributions.find((c) => c.method === method);
      return found ? { rank: found.rank, score: found.score } : undefined;
    };
    return [
      {
        chunk,
        fusedScore: result.fusedScore,
        method: methodOf(result),
        semantic: pick("semantic"),
        keyword: pick("keyword"),
      },
    ];
  });

  return {
    documentId: document._id,
    query,
    chunks,
    semantic: { used: semantic.reason === undefined, reason: semantic.reason },
    keyword: { used: true },
    latencyMs: Date.now() - started,
  };
}
