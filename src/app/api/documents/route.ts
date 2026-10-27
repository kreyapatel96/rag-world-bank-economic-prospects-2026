import { after } from "next/server";
import { AppError } from "@/lib/http/errors";
import { errorResponse, json } from "@/lib/http/route";
import { chunkingStrategySchema } from "@/lib/http/validation";
import {
  createDocumentFromUpload,
  listDocuments,
  sanitizeFilename,
  toDocumentDto,
  validatePdfUpload,
} from "@/lib/documents/service";
import { runIngestion } from "@/lib/ingestion/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const documents = await listDocuments();
    return json({ documents: documents.map(toDocumentDto) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw AppError.validation('Expected multipart form data with a PDF in the "file" field');
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw AppError.validation('Missing PDF in the "file" field');

    const data = Buffer.from(await file.arrayBuffer());
    validatePdfUpload({ name: file.name, type: file.type, size: data.length }, data);

    const rawStrategy = form.get("strategy");
    const strategy =
      typeof rawStrategy === "string" && rawStrategy
        ? chunkingStrategySchema.parse(rawStrategy)
        : undefined;

    const record = await createDocumentFromUpload(sanitizeFilename(file.name), data, strategy);
    after(() => runIngestion(record._id));
    return json({ document: toDocumentDto(record) }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
