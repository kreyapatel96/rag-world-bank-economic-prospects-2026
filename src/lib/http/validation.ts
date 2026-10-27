import { z } from "zod";

import { CHUNKING_STRATEGIES } from "@/lib/ingestion/strategies";

export const documentIdSchema = z.uuid();

export const chunkingStrategySchema = z.enum(CHUNKING_STRATEGIES);

export const reprocessSchema = z.object({ strategy: chunkingStrategySchema.optional() });

const question = z
  .string()
  .trim()
  .min(3, "Question is too short")
  .max(2000, "Question is too long");

export const askSchema = z.object({
  documentId: documentIdSchema,
  question,
  mode: z.enum(["gemini_fallback", "ollama"]).default("gemini_fallback"),
});

export const compareSchema = z.object({
  documentId: documentIdSchema,
  question,
});

export const evaluateSchema = z.object({
  documentId: documentIdSchema,
  mode: z.enum(["gemini_fallback", "ollama", "compare"]).default("gemini_fallback"),
  judge: z.enum(["gemini", "ollama", "none"]).default("none"),
  limit: z.number().int().min(1).max(500).optional(),
  questionsText: z.string().max(1_000_000).optional(),
  questionsFormat: z.enum(["json", "csv"]).optional(),
});

export const evaluateListSchema = z.object({ documentId: documentIdSchema });
