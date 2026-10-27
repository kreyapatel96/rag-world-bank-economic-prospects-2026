import { ollamaConfig } from "@/lib/config/env";

export class OllamaHttpError extends Error {
  constructor(
    readonly kind: "unreachable" | "timeout" | "http",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OllamaHttpError";
  }
}

export async function ollamaRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<T> {
  const { baseUrl } = ollamaConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new OllamaHttpError("timeout", `Ollama did not respond within ${options.timeoutMs} ms`);
    }
    throw new OllamaHttpError("unreachable", `Ollama is not reachable at ${baseUrl}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OllamaHttpError("http", detail.slice(0, 300) || response.statusText, response.status);
  }
  return (await response.json()) as T;
}

export async function listOllamaModels(timeoutMs = 3000): Promise<string[]> {
  const data = await ollamaRequest<{ models?: { name: string }[] }>("/api/tags", { timeoutMs });
  return (data.models ?? []).map((m) => m.name);
}

export function modelIsInstalled(installed: string[], wanted: string): boolean {
  const withTag = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return installed.some((name) => name === wanted || name === withTag);
}
