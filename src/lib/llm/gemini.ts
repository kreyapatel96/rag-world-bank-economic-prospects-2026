import { ApiError, GoogleGenAI } from "@google/genai";
import { geminiConfig, getEnv } from "@/lib/config/env";
import { withRetry } from "./retry";
import {
  ProviderError,
  type GenerationRequest,
  type GenerationResult,
  type LlmProvider,
} from "./types";

const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 1024;
// Thinking models spend part of the output budget on reasoning before the visible answer.
const THINKING_HEADROOM_TOKENS = 4096;

export function classifyGeminiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ApiError) {
    const message = error.message.toLowerCase();
    const status = error.status;
    if (
      status === 401 ||
      status === 403 ||
      message.includes("api key not valid") ||
      message.includes("api_key_invalid")
    ) {
      return new ProviderError(
        "gemini",
        "authentication",
        "Gemini rejected the API key or the project lacks access",
      );
    }
    if (status === 429) {
      const exhausted =
        message.includes("quota") && (message.includes("exceeded") || message.includes("billing"));
      return exhausted
        ? new ProviderError("gemini", "quota", "Gemini quota is exhausted")
        : new ProviderError("gemini", "rate_limit", "Gemini rate limit reached", true);
    }
    if (status === 404)
      return new ProviderError(
        "gemini",
        "model_unavailable",
        "The configured Gemini model was not found",
      );
    if (status === 408 || status === 504)
      return new ProviderError("gemini", "timeout", "Gemini request timed out", true);
    if (status >= 500)
      return new ProviderError("gemini", "server", `Gemini service error (${status})`, true);
    if (status >= 400)
      return new ProviderError("gemini", "bad_request", `Gemini rejected the request (${status})`);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProviderError("gemini", "timeout", "Gemini request timed out", true);
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error.message))
  ) {
    return new ProviderError("gemini", "network", "Could not reach the Gemini API", true);
  }
  return new ProviderError("gemini", "unknown", "Gemini request failed unexpectedly");
}

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini" as const;

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const { apiKey, model } = geminiConfig();
    if (!apiKey) throw new ProviderError("gemini", "configuration", "GEMINI_API_KEY is not set");
    if (!model) throw new ProviderError("gemini", "configuration", "GEMINI_MODEL is not set");
    const timeoutMs = getEnv().LLM_TIMEOUT_MS;
    const client = new GoogleGenAI({ apiKey });

    const call = async (): Promise<GenerationResult> => {
      try {
        const response = await client.models.generateContent({
          model,
          contents: request.userPrompt,
          config: {
            systemInstruction: request.systemPrompt,
            temperature: 0,
            maxOutputTokens:
              (request.maxOutputTokens ?? MAX_OUTPUT_TOKENS) + THINKING_HEADROOM_TOKENS,
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
        const text = response.text?.trim();
        if (!text) {
          const reason =
            response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason;
          throw new ProviderError(
            "gemini",
            "empty_response",
            `Gemini returned no text${reason ? ` (${reason})` : ""}`,
          );
        }
        if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
          throw new ProviderError(
            "gemini",
            "truncated",
            "Gemini stopped before finishing the answer",
          );
        }
        return { text, model };
      } catch (error) {
        throw classifyGeminiError(error);
      }
    };

    return withRetry(call, {
      maxAttempts: MAX_ATTEMPTS,
      baseDelayMs: 600,
      maxDelayMs: 6000,
      deadlineMs: timeoutMs * 2,
    });
  }
}
