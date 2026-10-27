import { errorResponse, json, parseJsonBody } from "@/lib/http/route";
import { compareSchema } from "@/lib/http/validation";
import { answerQuestion } from "@/lib/rag/answer";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const body = compareSchema.parse(await parseJsonBody(request));
    return json(await answerQuestion({ ...body, mode: "compare" }));
  } catch (error) {
    return errorResponse(error);
  }
}
