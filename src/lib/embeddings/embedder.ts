import { getEnv, ollamaConfig } from "@/lib/config/env";
import { AppError } from "@/lib/http/errors";
import {
  listOllamaModels,
  modelIsInstalled,
  OllamaHttpError,
  ollamaRequest,
} from "@/lib/ollama/client";

export type EmbeddingKind = "document" | "query";

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
}

function withTaskPrefix(model: string, kind: EmbeddingKind, text: string): string {
  if (!model.startsWith("nomic-embed-text")) return text;
  return `${kind === "document" ? "search_document" : "search_query"}: ${text}`;
}

function toEmbeddingError(error: unknown, model: string): AppError {
  if (error instanceof OllamaHttpError) {
    if (error.kind === "http" && error.status === 404) {
      return new AppError(
        "embedding_error",
        `Embedding model "${model}" is not installed in Ollama. Run: ollama pull ${model}`,
        503,
      );
    }
    return new AppError("embedding_error", `Embedding failed: ${error.message}`, 503);
  }
  return new AppError("embedding_error", "Embedding failed unexpectedly", 500);
}

export async function embedTexts(texts: string[], kind: EmbeddingKind): Promise<EmbeddingResult> {
  const { embeddingModel: model } = ollamaConfig();
  if (texts.length === 0) return { vectors: [], model, dimensions: 0 };
  let response: { embeddings?: number[][] };
  try {
    response = await ollamaRequest("/api/embed", {
      body: { model, input: texts.map((t) => withTaskPrefix(model, kind, t)), truncate: true },
      timeoutMs: 120_000,
    });
  } catch (error) {
    throw toEmbeddingError(error, model);
  }
  const vectors = response.embeddings;
  if (!vectors || vectors.length !== texts.length) {
    throw new AppError(
      "embedding_error",
      "Ollama returned an unexpected number of embeddings",
      502,
    );
  }
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some((v) => v.length !== dimensions)) {
    throw new AppError(
      "embedding_error",
      "Ollama returned embeddings with inconsistent dimensions",
      502,
    );
  }
  return { vectors, model, dimensions };
}

export async function embedInBatches(
  texts: string[],
  kind: EmbeddingKind,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<EmbeddingResult> {
  const batchSize = getEnv().EMBEDDING_BATCH_SIZE;
  const vectors: number[][] = [];
  let model = ollamaConfig().embeddingModel;
  let dimensions = 0;
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = await embedTexts(texts.slice(start, start + batchSize), kind);
    if (dimensions !== 0 && batch.dimensions !== dimensions) {
      throw new AppError("embedding_error", "Embedding dimensions changed during ingestion", 502);
    }
    dimensions = batch.dimensions;
    model = batch.model;
    vectors.push(...batch.vectors);
    await onProgress?.(vectors.length, texts.length);
  }
  return { vectors, model, dimensions };
}

export async function checkEmbeddingModel(): Promise<{ ok: boolean; message: string }> {
  const { embeddingModel } = ollamaConfig();
  try {
    const installed = await listOllamaModels();
    return modelIsInstalled(installed, embeddingModel)
      ? { ok: true, message: `Embedding model "${embeddingModel}" is available` }
      : {
          ok: false,
          message: `Embedding model "${embeddingModel}" is not installed. Run: ollama pull ${embeddingModel}`,
        };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Ollama check failed" };
  }
}
