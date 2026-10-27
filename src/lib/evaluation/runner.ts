import { randomUUID } from "node:crypto";
import { getEnv, ollamaConfig } from "@/lib/config/env";
import { evalRunsCollection } from "@/lib/db/collections";
import { getDocumentOrThrow } from "@/lib/documents/service";
import { defaultProviders, type ProviderSet } from "@/lib/llm/orchestrator";
import type { FailureCategory, GenerationMode, ProviderId } from "@/lib/llm/types";
import { answerQuestion } from "@/lib/rag/answer";
import { defaultRetrievalOptions } from "@/lib/retrieval/retriever";
import type { EvalQuestion } from "./dataset";
import { judgeCorrectness, judgeSupport } from "./judge";
import { citationAccuracy, mean, retrievalMetrics } from "./metrics";
import type {
  EvalReport,
  ProviderSummary,
  QuestionAnswerResult,
  QuestionResult,
  Verdict,
} from "./types";

export interface EvaluationParams {
  documentId: string;
  questions: EvalQuestion[];
  mode: GenerationMode;
  judge: ProviderId | "none";
  providers?: ProviderSet;
  onProgress?: (done: number, total: number) => void;
}

const VERDICT_SCORE: Record<Verdict, number> = { correct: 1, partial: 0.5, incorrect: 0 };

const pageLabel = (start: number, end: number) => (start === end ? `${start}` : `${start}-${end}`);

async function evaluateQuestion(
  question: EvalQuestion,
  params: EvaluationParams,
  providers: ProviderSet,
  k: number,
): Promise<QuestionResult> {
  const base: QuestionResult = {
    id: question.id,
    question: question.question,
    expectedAnswer: question.expectedAnswer,
    relevantPages: question.relevantPages,
    retrievedPages: [],
    noContext: false,
    semanticUsed: false,
    answers: [],
  };
  try {
    const response = await answerQuestion({
      documentId: params.documentId,
      question: question.question,
      mode: params.mode,
      providers,
      retrievalOptions: { ...defaultRetrievalOptions(), finalK: k },
    });
    const ranges = response.retrieval.chunks.map((c) => ({
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
    }));
    const contextText = response.context.passages
      .map((p) => `[${p.sourceId}] ${p.text}`)
      .join("\n\n");
    const judge = params.judge === "none" ? null : providers[params.judge];

    const answers: QuestionAnswerResult[] = [];
    for (const answer of response.answers) {
      if (answer.status === "failed") {
        answers.push({
          provider: answer.provider,
          status: "failed",
          latencyMs: answer.latencyMs,
          failureCategory: answer.failure?.category,
        });
        continue;
      }
      const citedRanges = answer.citations.map((c) => ({
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
      }));
      const result: QuestionAnswerResult = {
        provider: answer.provider,
        status: "success",
        latencyMs: answer.latencyMs,
        insufficientEvidence: answer.insufficientEvidence,
        citedPages: answer.citations.map(
          (c) => `${c.sourceId}: ${pageLabel(c.pageStart, c.pageEnd)}`,
        ),
        validCitations: answer.citations.length,
        citationAccuracy: question.relevantPages
          ? citationAccuracy(citedRanges, question.relevantPages)
          : null,
        answer: answer.text,
      };
      if (judge && answer.text && !answer.insufficientEvidence) {
        if (question.expectedAnswer) {
          result.verdict = await judgeCorrectness(judge, {
            question: question.question,
            expectedAnswer: question.expectedAnswer,
            answer: answer.text,
          });
        }
        result.claims = await judgeSupport(judge, {
          answer: answer.text,
          context: contextText,
          contextTokens: response.context.totalTokens,
        });
      } else if (judge && question.expectedAnswer && answer.insufficientEvidence) {
        result.verdict = "incorrect";
      }
      answers.push(result);
    }

    return {
      ...base,
      retrievedPages: response.retrieval.chunks.map((c) => pageLabel(c.pageStart, c.pageEnd)),
      retrieval: question.relevantPages
        ? retrievalMetrics(ranges, question.relevantPages, k)
        : undefined,
      noContext: response.status === "no_context",
      semanticUsed: response.retrieval.semantic.used,
      answers,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "Question failed" };
  }
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function summarizeProvider(provider: ProviderId, results: QuestionResult[]): ProviderSummary {
  const answers = results.flatMap((r) => r.answers).filter((a) => a.provider === provider);
  const succeeded = answers.filter((a) => a.status === "success");
  const failuresByCategory: Partial<Record<FailureCategory, number>> = {};
  for (const a of answers) {
    if (a.status === "failed" && a.failureCategory) {
      failuresByCategory[a.failureCategory] = (failuresByCategory[a.failureCategory] ?? 0) + 1;
    }
  }
  const answered = succeeded.filter((a) => !a.insufficientEvidence);
  const verdicts = succeeded.map((a) => a.verdict).filter((v): v is Verdict => Boolean(v));
  const counts: Record<Verdict, number> = { correct: 0, partial: 0, incorrect: 0 };
  for (const v of verdicts) counts[v]++;
  const claims = succeeded.flatMap((a) => (a.claims ? [a.claims] : []));
  const claimTotal = claims.reduce((n, c) => n + c.total, 0);
  const claimUnsupported = claims.reduce((n, c) => n + c.unsupported, 0);

  return {
    provider,
    attempted: answers.length,
    succeeded: succeeded.length,
    failed: answers.length - succeeded.length,
    failureRate: answers.length > 0 ? (answers.length - succeeded.length) / answers.length : 0,
    failuresByCategory,
    meanLatencyMs: mean(succeeded.map((a) => a.latencyMs)),
    insufficientEvidenceRate: rate(succeeded.length - answered.length, succeeded.length),
    citedAnswerRate: rate(
      answered.filter((a) => (a.validCitations ?? 0) > 0).length,
      answered.length,
    ),
    meanCitationAccuracy: mean(
      answered.map((a) => a.citationAccuracy).filter((v): v is number => typeof v === "number"),
    ),
    correctness: {
      judged: verdicts.length,
      meanScore: mean(verdicts.map((v) => VERDICT_SCORE[v])),
      counts,
    },
    unsupportedClaims: {
      claims: claimTotal,
      unsupported: claimUnsupported,
      rate: rate(claimUnsupported, claimTotal),
    },
  };
}

export async function runEvaluation(params: EvaluationParams): Promise<EvalReport> {
  const document = await getDocumentOrThrow(params.documentId);
  const providers = params.providers ?? defaultProviders();
  const env = getEnv();
  const k = defaultRetrievalOptions().finalK;
  const results: QuestionResult[] = [];

  for (const question of params.questions) {
    results.push(await evaluateQuestion(question, params, providers, k));
    params.onProgress?.(results.length, params.questions.length);
  }

  const withContext = results.filter((r) => !r.error);
  const labelled = withContext.filter((r) => r.retrieval);
  const providerIds: ProviderId[] =
    params.mode === "compare"
      ? ["gemini", "ollama"]
      : params.mode === "ollama"
        ? ["ollama"]
        : ["gemini", "ollama"];

  const notes = [
    "Retrieval metrics use page overlap between retrieved chunks and the labelled relevant pages; only questions with relevant pages are included.",
    "Citation accuracy is the share of cited passages whose page range overlaps the labelled relevant pages (labelled questions only).",
    "Answer correctness and unsupported-claim rate are LLM-judged (not human-verified); they are null unless a judge model is selected.",
    "No external evaluation framework such as RAGAS was used.",
  ];
  if (params.mode === "gemini_fallback") {
    notes.push("In fallback mode the Ollama row only reflects questions where Gemini failed.");
  }

  return {
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    documentId: params.documentId,
    mode: params.mode,
    judge: params.judge,
    k,
    settings: {
      retrievalTopK: env.RETRIEVAL_TOP_K,
      rerankTopK: env.RERANK_TOP_K,
      rrfK: env.RRF_K,
      maxContextTokens: env.MAX_CONTEXT_TOKENS,
      chunkTargetTokens: env.CHUNK_TARGET_TOKENS,
      embeddingModel: ollamaConfig().embeddingModel,
      documentEmbeddingModel: document.embeddingModel ?? "unknown",
      geminiModel: env.GEMINI_MODEL ?? "unset",
      ollamaModel: env.OLLAMA_CHAT_MODEL ?? "unset",
    },
    questionCount: results.length,
    labelledCount: labelled.length,
    retrieval: {
      nonEmptyRate: rate(withContext.filter((r) => !r.noContext).length, withContext.length),
      hitRate: rate(labelled.filter((r) => r.retrieval?.hit).length, labelled.length),
      meanRecall: mean(labelled.map((r) => r.retrieval?.recall ?? 0)),
      meanPrecision: mean(labelled.map((r) => r.retrieval?.precision ?? 0)),
      meanReciprocalRank: mean(labelled.map((r) => r.retrieval?.reciprocalRank ?? 0)),
    },
    providers: providerIds
      .map((id) => summarizeProvider(id, results))
      .filter((p) => p.attempted > 0),
    questions: results,
    notes,
  };
}

export async function saveEvaluation(report: EvalReport): Promise<void> {
  const runs = await evalRunsCollection();
  await runs.insertOne({
    _id: report.runId,
    documentId: report.documentId,
    createdAt: new Date(report.createdAt),
    report,
  });
}

export async function listEvaluations(documentId: string, limit = 10): Promise<EvalReport[]> {
  const runs = await evalRunsCollection();
  const records = await runs.find({ documentId }).sort({ createdAt: -1 }).limit(limit).toArray();
  return records.map((r) => r.report as EvalReport);
}
