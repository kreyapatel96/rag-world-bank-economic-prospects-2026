import { describe, expect, it, vi } from "vitest";
import { generateWithMode, type ProviderSet } from "@/lib/llm/orchestrator";
import { withRetry } from "@/lib/llm/retry";
import {
  ProviderError,
  type FailureCategory,
  type LlmProvider,
  type ProviderId,
} from "@/lib/llm/types";

const request = { systemPrompt: "s", userPrompt: "u", contextTokens: 10 };

function provider(
  id: ProviderId,
  behaviour: () => Promise<string>,
): LlmProvider & { calls: number } {
  return {
    id,
    calls: 0,
    async generate() {
      this.calls++;
      return { text: await behaviour(), model: `${id}-model` };
    },
  };
}

const failing = (id: ProviderId, category: FailureCategory) =>
  provider(id, async () => {
    throw new ProviderError(id, category, `${id} ${category}`);
  });

const set = (gemini: LlmProvider, ollama: LlmProvider): ProviderSet => ({ gemini, ollama });

describe("generation modes", () => {
  it("returns Gemini only when it succeeds and never calls Ollama", async () => {
    const gemini = provider("gemini", async () => "gemini answer");
    const ollama = provider("ollama", async () => "ollama answer");
    const attempts = await generateWithMode("gemini_fallback", request, set(gemini, ollama));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      provider: "gemini",
      status: "success",
      usedAsFallback: false,
    });
    expect(ollama.calls).toBe(0);
  });

  it.each<FailureCategory>([
    "quota",
    "rate_limit",
    "network",
    "server",
    "authentication",
    "configuration",
  ])("falls back to Ollama when Gemini fails with %s", async (category) => {
    const attempts = await generateWithMode(
      "gemini_fallback",
      request,
      set(
        failing("gemini", category),
        provider("ollama", async () => "local answer"),
      ),
    );
    expect(attempts.map((a) => [a.provider, a.status])).toEqual([
      ["gemini", "failed"],
      ["ollama", "success"],
    ]);
    expect(attempts[0]?.failure?.category).toBe(category);
    expect(attempts[1]?.usedAsFallback).toBe(true);
  });

  it("reports both failures without throwing when Ollama also fails", async () => {
    const attempts = await generateWithMode(
      "gemini_fallback",
      request,
      set(failing("gemini", "quota"), failing("ollama", "network")),
    );
    expect(attempts.every((a) => a.status === "failed")).toBe(true);
  });

  it("does not treat an insufficient-evidence answer as a provider failure", async () => {
    const ollama = provider("ollama", async () => "x");
    const gemini = provider(
      "gemini",
      async () => "The report context does not provide enough information to answer this question.",
    );
    const attempts = await generateWithMode("gemini_fallback", request, set(gemini, ollama));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("success");
    expect(ollama.calls).toBe(0);
  });

  it("uses only Ollama in ollama mode", async () => {
    const gemini = provider("gemini", async () => "g");
    const attempts = await generateWithMode(
      "ollama",
      request,
      set(
        gemini,
        provider("ollama", async () => "o"),
      ),
    );
    expect(attempts.map((a) => a.provider)).toEqual(["ollama"]);
    expect(gemini.calls).toBe(0);
  });

  it("compare mode runs both providers and keeps the successful answer when one fails", async () => {
    const attempts = await generateWithMode(
      "compare",
      request,
      set(
        failing("gemini", "rate_limit"),
        provider("ollama", async () => "o"),
      ),
    );
    expect(attempts.map((a) => [a.provider, a.status])).toEqual([
      ["gemini", "failed"],
      ["ollama", "success"],
    ]);
    expect(attempts.every((a) => !a.usedAsFallback)).toBe(true);
  });
});

describe("bounded retry", () => {
  const options = {
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 2,
    deadlineMs: 10_000,
    sleep: async () => undefined,
  };

  it("retries transient errors and then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new ProviderError("gemini", "server", "boom", true);
      return "ok";
    }, options);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops after the maximum number of attempts", async () => {
    const operation = vi.fn(async () => {
      throw new ProviderError("gemini", "server", "boom", true);
    });
    await expect(withRetry(operation, options)).rejects.toThrow("boom");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors such as exhausted quota or bad credentials", async () => {
    const operation = vi.fn(async () => {
      throw new ProviderError("gemini", "quota", "quota", false);
    });
    await expect(withRetry(operation, options)).rejects.toThrow("quota");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("truncated replies", () => {
  it("trims a cut-off Ollama reply to its last complete sentence", async () => {
    const { trimToLastSentence } = await import("@/lib/llm/ollama");
    expect(
      trimToLastSentence(
        "Growth is 6.3 percent [S2]. India slows to 6.6 percent [S2]. Bangladesh is exp",
      ),
    ).toBe("Growth is 6.3 percent [S2]. India slows to 6.6 percent [S2].");
    expect(trimToLastSentence("No sentence end here")).toBe("No sentence end here");
  });
});
