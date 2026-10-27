import { errorMessage } from "@/lib/http/errors";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import {
  ProviderError,
  type GenerationMode,
  type GenerationRequest,
  type LlmProvider,
  type ProviderAttempt,
  type ProviderId,
} from "./types";

export interface ProviderSet {
  gemini: LlmProvider;
  ollama: LlmProvider;
}

export function defaultProviders(): ProviderSet {
  return { gemini: new GeminiProvider(), ollama: new OllamaProvider() };
}

async function runProvider(
  provider: LlmProvider,
  request: GenerationRequest,
  usedAsFallback: boolean,
): Promise<ProviderAttempt> {
  const started = Date.now();
  try {
    const result = await provider.generate(request);
    const attempt: ProviderAttempt = {
      provider: provider.id,
      status: "success",
      model: result.model,
      text: result.text,
      latencyMs: Date.now() - started,
      usedAsFallback,
    };
    logAttempt(attempt);
    return attempt;
  } catch (error) {
    const category = error instanceof ProviderError ? error.category : "unknown";
    const message = error instanceof ProviderError ? error.message : "Provider call failed";
    if (!(error instanceof ProviderError))
      console.error("Unclassified provider error:", errorMessage(error));
    const attempt: ProviderAttempt = {
      provider: provider.id,
      status: "failed",
      latencyMs: Date.now() - started,
      failure: { category, message },
      usedAsFallback,
    };
    logAttempt(attempt);
    return attempt;
  }
}

function logAttempt(attempt: ProviderAttempt) {
  console.info(
    JSON.stringify({
      event: "llm_attempt",
      provider: attempt.provider,
      status: attempt.status,
      latencyMs: attempt.latencyMs,
      category: attempt.failure?.category,
      fallback: attempt.usedAsFallback,
    }),
  );
}

export type ProviderRequests = GenerationRequest | Record<ProviderId, GenerationRequest>;

function requestFor(requests: ProviderRequests, provider: ProviderId): GenerationRequest {
  return "systemPrompt" in requests ? requests : requests[provider];
}

export async function generateWithMode(
  mode: GenerationMode,
  requests: ProviderRequests,
  providers: ProviderSet = defaultProviders(),
): Promise<ProviderAttempt[]> {
  const geminiRequest = requestFor(requests, "gemini");
  const ollamaRequest = requestFor(requests, "ollama");
  if (mode === "ollama") return [await runProvider(providers.ollama, ollamaRequest, false)];

  if (mode === "compare") {
    return Promise.all([
      runProvider(providers.gemini, geminiRequest, false),
      runProvider(providers.ollama, ollamaRequest, false),
    ]);
  }

  const primary = await runProvider(providers.gemini, geminiRequest, false);
  if (primary.status === "success") return [primary];
  const fallback = await runProvider(providers.ollama, ollamaRequest, true);
  return [primary, fallback];
}
