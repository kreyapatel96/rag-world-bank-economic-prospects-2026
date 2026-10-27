import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Request validation failed",
          details: {
            issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
      },
      { status: 400 },
    );
  }
  console.error("Unhandled route error:", error instanceof Error ? error.name : typeof error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Unexpected server error" } },
    { status: 500 },
  );
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw AppError.validation("Request body must be valid JSON");
  }
}
