import type { FailureCategory, GenerationMode, ProviderId } from "@/lib/llm/types";

export type Verdict = "correct" | "partial" | "incorrect";

export interface QuestionAnswerResult {
  provider: ProviderId;
  status: "success" | "failed";
  latencyMs: number;
  failureCategory?: FailureCategory;
  insufficientEvidence?: boolean;
  citedPages?: string[];
  citationAccuracy?: number | null;
  validCitations?: number;
  verdict?: Verdict | null;
  claims?: { total: number; unsupported: number } | null;
  answer?: string;
}

export interface QuestionResult {
  id: string;
  question: string;
  expectedAnswer?: string;
  relevantPages?: number[];
  retrievedPages: string[];
  retrieval?: { hit: boolean; recall: number; precision: number; reciprocalRank: number };
  noContext: boolean;
  semanticUsed: boolean;
  answers: QuestionAnswerResult[];
  error?: string;
}

export interface ProviderSummary {
  provider: ProviderId;
  attempted: number;
  succeeded: number;
  failed: number;
  failureRate: number;
  failuresByCategory: Partial<Record<FailureCategory, number>>;
  meanLatencyMs: number | null;
  insufficientEvidenceRate: number | null;
  citedAnswerRate: number | null;
  meanCitationAccuracy: number | null;
  correctness: { judged: number; meanScore: number | null; counts: Record<Verdict, number> };
  unsupportedClaims: { claims: number; unsupported: number; rate: number | null };
}

export interface EvalReport {
  runId: string;
  createdAt: string;
  documentId: string;
  mode: GenerationMode;
  judge: ProviderId | "none";
  k: number;
  settings: Record<string, string | number>;
  questionCount: number;
  labelledCount: number;
  retrieval: {
    nonEmptyRate: number | null;
    hitRate: number | null;
    meanRecall: number | null;
    meanPrecision: number | null;
    meanReciprocalRank: number | null;
  };
  providers: ProviderSummary[];
  questions: QuestionResult[];
  notes: string[];
}
