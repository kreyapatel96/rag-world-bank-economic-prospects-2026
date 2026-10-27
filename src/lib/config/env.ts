import { z } from "zod";
import { AppError } from "@/lib/http/errors";
import { CHUNKING_STRATEGIES } from "@/lib/ingestion/strategies";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const positiveInt = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(fallback));

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());

const schema = z.object({
  MONGODB_URI: optionalString,
  MONGODB_DB_NAME: z.preprocess(blankToUndefined, z.string().default("worldbank_rag")),
  MONGODB_VECTOR_INDEX_NAME: z.preprocess(
    blankToUndefined,
    z.string().default("worldbank_vector_index"),
  ),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  OLLAMA_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().default("http://localhost:11434"),
  ),
  OLLAMA_CHAT_MODEL: optionalString,
  OLLAMA_EMBEDDING_MODEL: z.preprocess(blankToUndefined, z.string().default("nomic-embed-text")),
  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(["gemini", "ollama"]).default("gemini")),
  MAX_CONTEXT_TOKENS: positiveInt(6000),
  RETRIEVAL_TOP_K: positiveInt(20),
  RERANK_TOP_K: positiveInt(8),
  MAX_UPLOAD_SIZE_MB: positiveInt(50),
  CHUNK_TARGET_TOKENS: positiveInt(400),
  CHUNK_MAX_TOKENS: positiveInt(600),
  CHUNKING_STRATEGY: z.preprocess(
    blankToUndefined,
    z.enum(CHUNKING_STRATEGIES).default("hierarchical"),
  ),
  CHUNK_WINDOW_SENTENCES: positiveInt(5),
  CHUNK_OVERLAP_TOKENS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(60)),
  RRF_K: positiveInt(60),
  OLLAMA_MAX_CONTEXT_TOKENS: positiveInt(2500),
  LLM_TIMEOUT_MS: positiveInt(60000),
  EMBEDDING_BATCH_SIZE: positiveInt(16),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw AppError.configuration(`Invalid environment configuration for: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}

export function requireMongoEnv() {
  const env = getEnv();
  if (!env.MONGODB_URI) throw AppError.configuration("MONGODB_URI is not set");
  return {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB_NAME,
    vectorIndexName: env.MONGODB_VECTOR_INDEX_NAME,
  };
}

export function geminiConfig() {
  const env = getEnv();
  return { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL };
}

export function ollamaConfig() {
  const env = getEnv();
  return {
    baseUrl: env.OLLAMA_BASE_URL.replace(/\/+$/, ""),
    chatModel: env.OLLAMA_CHAT_MODEL,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
  };
}
