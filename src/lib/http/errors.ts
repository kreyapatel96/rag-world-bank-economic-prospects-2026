export type ErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "configuration_error"
  | "database_error"
  | "vector_index_missing"
  | "embedding_error"
  | "provider_error"
  | "internal_error";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  static validation(message: string, details?: Record<string, unknown>) {
    return new AppError("validation_failed", message, 400, details);
  }

  static notFound(message: string) {
    return new AppError("not_found", message, 404);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new AppError("conflict", message, 409, details);
  }

  static configuration(message: string) {
    return new AppError("configuration_error", message, 503);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
