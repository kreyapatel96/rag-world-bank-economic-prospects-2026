export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", "network", 0);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status})`,
      error?.code ?? "unknown",
      response.status,
    );
  }
  return payload as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

export const decimal = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined ? "n/a" : value.toFixed(digits);

export const milliseconds = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${Math.round(value)} ms`;
