import { errorResponse, json } from "@/lib/http/route";
import { documentIdSchema } from "@/lib/http/validation";
import { deleteDocument, getDocumentOrThrow, toDocumentDto } from "@/lib/documents/service";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const id = documentIdSchema.parse((await context.params).id);
    return json({ document: toDocumentDto(await getDocumentOrThrow(id)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const id = documentIdSchema.parse((await context.params).id);
    await deleteDocument(id);
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
