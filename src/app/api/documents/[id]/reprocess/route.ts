import { after } from "next/server";
import { errorResponse, json } from "@/lib/http/route";
import { documentIdSchema, reprocessSchema } from "@/lib/http/validation";
import { markForReprocessing, toDocumentDto } from "@/lib/documents/service";
import { runIngestion } from "@/lib/ingestion/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = documentIdSchema.parse((await context.params).id);
    const body = reprocessSchema.parse(await request.json().catch(() => ({})));
    const record = await markForReprocessing(id, body.strategy);
    after(() => runIngestion(id));
    return json({ document: toDocumentDto(record) }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
