import type { Citation } from "@/lib/citations/citations";
import type { FailureCategory, GenerationMode, ProviderId } from "@/lib/llm/types";

export interface RetrievedChunkDto {
  chunkId: string;
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  pageStart: number;
  pageEnd: number;
  kind: "text" | "table";
  text: string;
  fusedScore: number;
  method: "semantic" | "keyword" | "hybrid";
  semantic?: { rank: number; score: number };
  keyword?: { rank: number; score: number };
}

export interface PassageDto {
  sourceId: string;
  chunkIds: string[];
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  tokens: number;
  expanded: boolean;
}

export interface AnswerDto {
  provider: ProviderId;
  model?: string;
  status: "success" | "failed";
  text?: string;
  citations: Citation[];
  invalidCitationMarkers: string[];
  insufficientEvidence: boolean;
  uncited: boolean;
  latencyMs: number;
  usedAsFallback: boolean;
  failure?: { category: FailureCategory; message: string };
}

export interface RagResponse {
  documentId: string;
  question: string;
  mode: GenerationMode;
  status: "answered" | "no_context" | "failed";
  retrieval: {
    chunks: RetrievedChunkDto[];
    semantic: { used: boolean; reason?: string };
    latencyMs: number;
  };
  context: {
    passages: PassageDto[];
    totalTokens: number;
    budgetTokens: number;
  };
  answers: AnswerDto[];
  selectedProvider: ProviderId | null;
}
