import { ProviderError } from "./types";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  deadlineMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt >= options.maxAttempts) throw error;
      const backoff = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      const delay = backoff / 2 + Math.random() * (backoff / 2);
      if (Date.now() - started + delay > options.deadlineMs) throw error;
      await sleep(delay);
    }
  }
}
