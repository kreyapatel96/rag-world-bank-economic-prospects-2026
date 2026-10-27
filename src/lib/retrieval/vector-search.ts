import { requireMongoEnv } from "@/lib/config/env";
import { chunksCollection } from "@/lib/db/collections";
import { AppError } from "@/lib/http/errors";
import type { ScoredChunk } from "./bm25";

export async function semanticSearch(params: {
  documentId: string;
  embeddingModel: string;
  queryVector: number[];
  limit: number;
}): Promise<ScoredChunk[]> {
  const { vectorIndexName } = requireMongoEnv();
  const chunks = await chunksCollection();
  try {
    const results = await chunks
      .aggregate<{ _id: string; score: number }>([
        {
          $vectorSearch: {
            index: vectorIndexName,
            path: "embedding",
            queryVector: params.queryVector,
            numCandidates: Math.max(params.limit * 10, 100),
            limit: params.limit,
            filter: { documentId: params.documentId, embeddingModel: params.embeddingModel },
          },
        },
        { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    return results.map((r) => ({ chunkId: r._id, score: r.score }));
  } catch {
    throw new AppError(
      "vector_index_missing",
      `Vector search failed. Confirm the Atlas Vector Search index "${vectorIndexName}" exists, is queryable, and matches the embedding dimensions.`,
      503,
    );
  }
}
