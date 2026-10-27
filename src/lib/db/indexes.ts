import { requireMongoEnv } from "@/lib/config/env";
import {
  chunksCollection,
  COLLECTIONS,
  documentsCollection,
  evalRunsCollection,
  postingsCollection,
  sectionsCollection,
} from "./collections";
import { getDb } from "./mongo";

export function vectorIndexDefinition(numDimensions: number) {
  return {
    fields: [
      { type: "vector", path: "embedding", numDimensions, similarity: "cosine" },
      { type: "filter", path: "documentId" },
      { type: "filter", path: "embeddingModel" },
    ],
  };
}

export async function ensureStandardIndexes() {
  const [documents, sections, chunks, postings, evalRuns] = await Promise.all([
    documentsCollection(),
    sectionsCollection(),
    chunksCollection(),
    postingsCollection(),
    evalRunsCollection(),
  ]);
  await Promise.all([
    documents.createIndex({ fileHash: 1 }, { unique: true }),
    documents.createIndex({ createdAt: -1 }),
    sections.createIndex({ documentId: 1, order: 1 }),
    chunks.createIndex({ documentId: 1, order: 1 }, { unique: true }),
    chunks.createIndex({ documentId: 1, sectionId: 1, order: 1 }),
    postings.createIndex({ documentId: 1, term: 1 }, { unique: true }),
    evalRuns.createIndex({ documentId: 1, createdAt: -1 }),
  ]);
}

export interface VectorIndexStatus {
  state: "ready" | "building" | "missing" | "dimension_mismatch" | "unknown";
  message: string;
  numDimensions?: number;
}

export async function inspectVectorIndex(expectedDimensions?: number): Promise<VectorIndexStatus> {
  const { vectorIndexName } = requireMongoEnv();
  const chunks = await chunksCollection();
  try {
    const indexes = await chunks.listSearchIndexes(vectorIndexName).toArray();
    const index = indexes[0] as
      | {
          queryable?: boolean;
          status?: string;
          latestDefinition?: { fields?: { type: string; numDimensions?: number }[] };
        }
      | undefined;
    if (!index) {
      return {
        state: "missing",
        message: `Atlas Vector Search index "${vectorIndexName}" does not exist. Run "npm run db:init" or create it in the Atlas UI.`,
      };
    }
    const vectorField = index.latestDefinition?.fields?.find((f) => f.type === "vector");
    const numDimensions = vectorField?.numDimensions;
    if (expectedDimensions && numDimensions && numDimensions !== expectedDimensions) {
      return {
        state: "dimension_mismatch",
        numDimensions,
        message: `Vector index is configured for ${numDimensions} dimensions but embeddings have ${expectedDimensions}.`,
      };
    }
    if (!index.queryable) {
      return {
        state: "building",
        numDimensions,
        message: `Vector index status: ${index.status ?? "building"}.`,
      };
    }
    return { state: "ready", numDimensions, message: "Vector index is queryable." };
  } catch {
    return {
      state: "unknown",
      message:
        "Could not read search indexes. Vector search requires MongoDB Atlas (or an Atlas local deployment).",
    };
  }
}

export async function createVectorIndex(numDimensions: number): Promise<"created" | "exists"> {
  const { vectorIndexName } = requireMongoEnv();
  const db = await getDb();
  const existing = await db
    .collection(COLLECTIONS.chunks)
    .listSearchIndexes(vectorIndexName)
    .toArray();
  if (existing.length > 0) return "exists";
  await db.collection(COLLECTIONS.chunks).createSearchIndex({
    name: vectorIndexName,
    type: "vectorSearch",
    definition: vectorIndexDefinition(numDimensions),
  });
  return "created";
}
