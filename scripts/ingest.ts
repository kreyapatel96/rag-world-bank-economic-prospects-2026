import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createDocumentFromUpload,
  getDocumentOrThrow,
  markForReprocessing,
  sanitizeFilename,
  validatePdfUpload,
} from "@/lib/documents/service";
import { documentsCollection } from "@/lib/db/collections";
import { closeDb } from "@/lib/db/mongo";
import { AppError } from "@/lib/http/errors";
import { runIngestion } from "@/lib/ingestion/pipeline";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Usage: npm run ingest -- <path-to-report.pdf>");
  const data = await fs.readFile(filePath);
  const filename = sanitizeFilename(path.basename(filePath));
  validatePdfUpload({ name: filename, type: "application/pdf", size: data.length }, data);

  let documentId: string;
  try {
    documentId = (await createDocumentFromUpload(filename, data))._id;
  } catch (error) {
    const existingId =
      error instanceof AppError && error.code === "conflict"
        ? error.details?.documentId
        : undefined;
    if (typeof existingId !== "string") throw error;
    console.log(`Already uploaded (${existingId}); reprocessing.`);
    documentId = (await markForReprocessing(existingId))._id;
  }

  const documents = await documentsCollection();
  const timer = setInterval(async () => {
    const current = await documents.findOne({ _id: documentId });
    if (current) console.log(`${current.stage} (${current.progress}%)`);
  }, 3000);
  await runIngestion(documentId);
  clearInterval(timer);

  const result = await getDocumentOrThrow(documentId);
  if (result.status !== "ready")
    throw new Error(`Ingestion failed: ${result.error ?? "unknown error"}`);
  console.log(
    `Ready: ${result.pageCount} pages, ${result.sectionCount} sections, ${result.chunkCount} chunks, ${result.tableCount} tables.`,
  );
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  console.log(`Document ID: ${documentId}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
