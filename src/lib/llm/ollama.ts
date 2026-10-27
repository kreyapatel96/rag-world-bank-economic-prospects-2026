import { getEnv, ollamaConfig } from "@/lib/config/env";
import {
  listOllamaModels,
  modelIsInstalled,
  OllamaHttpError,
  ollamaRequest,
} from "@/lib/ollama/client";
import {
  ProviderError,
  type GenerationRequest,
  type GenerationResult,
  type LlmProvider,
} from "./types";

const RESPONSE_TOKEN_ALLOWANCE = 1536;
const MIN_CONTEXT_WINDOW = 4096;
const AVAILABILITY_TIMEOUT_MS = 3000;

// A reply cut off by the token limit is trimmed back to its last complete sentence or bullet.
export function trimToLastSentence(text: string): string {
  const end = Math.max(...[".", "!", "?"].map((c) => text.lastIndexOf(c)));
  return end > text.length * 0.4 ? text.slice(0, end + 1).trimEnd() : text;
}

function toProviderError(error: unknown, model: string): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof OllamaHttpError) {
    if (error.kind === "unreachable") return new ProviderError("ollama", "network", error.message);
    if (error.kind === "timeout") return new ProviderError("ollama", "timeout", error.message);
    if (error.status === 404) {
      return new ProviderError(
        "ollama",
        "model_unavailable",
        `Model "${model}" is not installed. Run: ollama pull ${model}`,
      );
    }
    if (error.status && error.status >= 500)
      return new ProviderError("ollama", "server", `Ollama error (${error.status})`);
    return new ProviderError(
      "ollama",
      "bad_request",
      `Ollama rejected the request (${error.status ?? "unknown"})`,
    );
  }
  return new ProviderError("ollama", "unknown", "Ollama request failed unexpectedly");
}

export class OllamaProvider implements LlmProvider {
  readonly id = "ollama" as const;

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const { chatModel: model } = ollamaConfig();
    if (!model) throw new ProviderError("ollama", "configuration", "OLLAMA_CHAT_MODEL is not set");

    try {
      const installed = await listOllamaModels(AVAILABILITY_TIMEOUT_MS);
      if (!modelIsInstalled(installed, model)) {
        throw new ProviderError(
          "ollama",
          "model_unavailable",
          `Model "${model}" is not installed. Run: ollama pull ${model}`,
        );
      }
      const numCtx = Math.max(
        MIN_CONTEXT_WINDOW,
        request.contextTokens + RESPONSE_TOKEN_ALLOWANCE + 1024,
      );
      const response = await ollamaRequest<{
        message?: { content?: string };
        done_reason?: string;
      }>("/api/chat", {
        body: {
          model,
          stream: false,
          keep_alive: "30m",
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          options: {
            temperature: 0,
            num_ctx: numCtx,
            num_predict: request.maxOutputTokens ?? RESPONSE_TOKEN_ALLOWANCE,
          },
        },
        timeoutMs: getEnv().LLM_TIMEOUT_MS * 2,
      });
      const text = response.message?.content?.trim();
      if (!text) throw new ProviderError("ollama", "empty_response", "Ollama returned no text");
      return { text: response.done_reason === "length" ? trimToLastSentence(text) : text, model };
    } catch (error) {
      throw toProviderError(error, model);
    }
  }
}
