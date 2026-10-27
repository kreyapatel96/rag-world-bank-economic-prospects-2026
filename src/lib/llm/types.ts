export type ProviderId = "gemini" | "ollama";

export type FailureCategory =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "server"
  | "model_unavailable"
  | "bad_request"
  | "empty_response"
  | "truncated"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly category: FailureCategory,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface GenerationRequest {
  systemPrompt: string;
  userPrompt: string;
  contextTokens: number;
  maxOutputTokens?: number;
}

export interface GenerationResult {
  text: string;
  model: string;
}

export interface LlmProvider {
  readonly id: ProviderId;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export type GenerationMode = "gemini_fallback" | "ollama" | "compare";

export interface ProviderAttempt {
  provider: ProviderId;
  status: "success" | "failed";
  model?: string;
  text?: string;
  latencyMs: number;
  failure?: { category: FailureCategory; message: string };
  usedAsFallback: boolean;
}
