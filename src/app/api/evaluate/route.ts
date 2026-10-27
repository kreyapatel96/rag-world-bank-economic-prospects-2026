import { AppError } from "@/lib/http/errors";
import { errorResponse, json, parseJsonBody } from "@/lib/http/route";
import { evaluateListSchema, evaluateSchema } from "@/lib/http/validation";
import { parseQuestions } from "@/lib/evaluation/dataset";
import { loadQuestionsFromDisk, saveReportToDisk } from "@/lib/evaluation/files";
import { listEvaluations, runEvaluation, saveEvaluation } from "@/lib/evaluation/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const { documentId } = evaluateListSchema.parse({
      documentId: new URL(request.url).searchParams.get("documentId"),
    });
    return json({ runs: await listEvaluations(documentId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = evaluateSchema.parse(await parseJsonBody(request));
    let questions;
    if (body.questionsText) {
      try {
        questions = parseQuestions(body.questionsText, body.questionsFormat ?? "json");
      } catch {
        throw AppError.validation("The uploaded questions file could not be parsed");
      }
    } else {
      questions = await loadQuestionsFromDisk();
    }
    if (questions.length === 0) throw AppError.validation("No usable questions were found");
    if (body.limit) questions = questions.slice(0, body.limit);

    const report = await runEvaluation({
      documentId: body.documentId,
      questions,
      mode: body.mode,
      judge: body.judge,
    });
    await saveEvaluation(report);
    if (process.env.VERCEL !== "1")
      await saveReportToDisk(report.runId, report).catch(() => undefined);
    return json({ report });
  } catch (error) {
    return errorResponse(error);
  }
}
