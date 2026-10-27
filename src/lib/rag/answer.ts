import { analyzeCitations } from "@/lib/citations/citations";
import { getEnv } from "@/lib/config/env";
import { buildContext } from "@/lib/context/builder";
import {
  buildUserPrompt,
  indicatesInsufficientEvidence,
  SYSTEM_PROMPT,
} from "@/lib/context/prompt";
import { getDocumentOrThrow } from "@/lib/documents/service";
import { defaultProviders, generateWithMode, type ProviderSet } from "@/lib/llm/orchestrator";
import type { GenerationMode, ProviderAttempt } from "@/lib/llm/types";
import {
  defaultRetrievalOptions,
  retrieve,
  type RetrievalOptions,
} from "@/lib/retrieval/retriever";
import type { ContextPassage } from "@/lib/context/builder";
import type { AnswerDto, RagResponse } from "./types";

const ANSWER_TOKEN_CAP = 450;

export interface AnswerParams {
  documentId: string;
  question: string;
  mode: GenerationMode;
  providers?: ProviderSet;
  retrievalOptions?: RetrievalOptions;
}

export function selectTopPassages(passages: ContextPassage[], maxTokens: number): ContextPassage[] {
  const chosen = new Set<string>();
  let used = 0;
  for (const passage of [...passages].sort((a, b) => b.score - a.score)) {
    if (used + passage.tokens > maxTokens && chosen.size > 0) continue;
    chosen.add(passage.sourceId);
    used += passage.tokens;
  }
  return passages.filter((p) => chosen.has(p.sourceId));
}

export function toAnswerDto(attempt: ProviderAttempt, passages: ContextPassage[]): AnswerDto {
  const base = {
    provider: attempt.provider,
    model: attempt.model,
    latencyMs: attempt.latencyMs,
    usedAsFallback: attempt.usedAsFallback,
  };
  if (attempt.status === "failed" || attempt.text === undefined) {
    return {
      ...base,
      status: "failed",
      citations: [],
      invalidCitationMarkers: [],
      insufficientEvidence: false,
      uncited: false,
      failure: attempt.failure,
    };
  }
  const insufficientEvidence = indicatesInsufficientEvidence(attempt.text);
  const analysis = analyzeCitations(attempt.text, passages);
  return {
    ...base,
    status: "success",
    text: analysis.answer,
    citations: insufficientEvidence ? [] : analysis.citations,
    invalidCitationMarkers: analysis.invalidMarkers,
    insufficientEvidence,
    uncited: !insufficientEvidence && analysis.citations.length === 0,
  };
}

export async function answerQuestion(params: AnswerParams): Promise<RagResponse> {
  const document = await getDocumentOrThrow(params.documentId);
  const retrieval = await retrieve(
    document,
    params.question,
    params.retrievalOptions ?? defaultRetrievalOptions(),
  );

  const retrievalDto: RagResponse["retrieval"] = {
    chunks: retrieval.chunks.map((r) => ({
      chunkId: r.chunk._id,
      chapterTitle: r.chunk.chapterTitle,
      sectionTitle: r.chunk.sectionTitle,
      subsectionTitle: r.chunk.subsectionTitle,
      pageStart: r.chunk.pageStart,
      pageEnd: r.chunk.pageEnd,
      kind: r.chunk.kind,
      text: r.chunk.text,
      fusedScore: r.fusedScore,
      method: r.method,
      semantic: r.semantic,
      keyword: r.keyword,
    })),
    semantic: retrieval.semantic,
    latencyMs: retrieval.latencyMs,
  };

  const budgetTokens = getEnv().MAX_CONTEXT_TOKENS;
  if (retrieval.chunks.length === 0) {
    return {
      documentId: document._id,
      question: params.question,
      mode: params.mode,
      status: "no_context",
      retrieval: retrievalDto,
      context: { passages: [], totalTokens: 0, budgetTokens },
      answers: [],
      selectedProvider: null,
    };
  }

  const context = await buildContext(retrieval.chunks, { maxTokens: budgetTokens });
  // Ollama runs on the local CPU, so it gets the highest-scoring passages that fit a smaller budget.
  const ollamaPassages = selectTopPassages(context.passages, getEnv().OLLAMA_MAX_CONTEXT_TOKENS);
  const requestFor = (passages: ContextPassage[]) => ({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(params.question, passages),
    contextTokens: passages.reduce((n, p) => n + p.tokens, 0),
    maxOutputTokens: ANSWER_TOKEN_CAP,
  });
  const attempts = await generateWithMode(
    params.mode,
    { gemini: requestFor(context.passages), ollama: requestFor(ollamaPassages) },
    params.providers ?? defaultProviders(),
  );
  const answers = attempts.map((a) =>
    toAnswerDto(a, a.provider === "ollama" ? ollamaPassages : context.passages),
  );
  const selected = answers.find((a) => a.status === "success");

  return {
    documentId: document._id,
    question: params.question,
    mode: params.mode,
    status: selected ? "answered" : "failed",
    retrieval: retrievalDto,
    context: {
      passages: context.passages.map((p) => ({
        sourceId: p.sourceId,
        chunkIds: p.chunkIds,
        chapterTitle: p.chapterTitle,
        sectionTitle: p.sectionTitle,
        subsectionTitle: p.subsectionTitle,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        text: p.text,
        tokens: p.tokens,
        expanded: p.expanded,
      })),
      totalTokens: context.totalTokens,
      budgetTokens,
    },
    answers,
    selectedProvider: selected?.provider ?? null,
  };
}
