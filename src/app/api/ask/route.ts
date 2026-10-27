import { errorResponse, json, parseJsonBody } from "@/lib/http/route";
import { askSchema } from "@/lib/http/validation";
import { answerQuestion } from "@/lib/rag/answer";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = askSchema.parse(await parseJsonBody(request));
    return json(await answerQuestion(body));
  } catch (error) {
    return errorResponse(error);
  }
}
