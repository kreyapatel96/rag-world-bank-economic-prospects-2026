import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import {
  chunksCollection,
  documentsCollection,
  evalRunsCollection,
  postingsCollection,
  sectionsCollection,
  statsCollection,
} from "@/lib/db/collections";
import type { DocumentRecord } from "@/lib/db/schemas";
import { AppError } from "@/lib/http/errors";
import { deleteBm25Index } from "@/lib/retrieval/bm25";
import { deleteOriginalPdf, saveOriginalPdf } from "@/lib/ingestion/storage";
import type { ChunkingStrategy } from "@/lib/ingestion/strategies";

const STALE_PROCESSING_MS = 15 * 60 * 1000;
const MAX_FILENAME_LENGTH = 150;

export interface DocumentDto {
  id: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  chunkingStrategy: string | null;
  techniques: string[];
  status: DocumentRecord["status"];
  stage: string;
  progress: number;
  chunkCount: number;
  sectionCount: number;
  tableCount: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDocumentDto(record: DocumentRecord): DocumentDto {
  return {
    id: record._id,
    filename: record.filename,
    fileSize: record.fileSize,
    pageCount: record.pageCount,
    chunkingStrategy: record.chunkingStrategy ?? null,
    techniques: record.techniques ?? [],
    status: record.status,
    stage: record.stage,
    progress: record.progress,
    chunkCount: record.chunkCount,
    sectionCount: record.sectionCount,
    tableCount: record.tableCount,
    embeddingModel: record.embeddingModel,
    embeddingDimensions: record.embeddingDimensions,
    warnings: record.warnings,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function sanitizeFilename(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, "/")).normalize("NFKC");
  const cleaned = base
    .replace(/[^\p{L}\p{N}.\-_ ()]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  const withExtension = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned || "document"}.pdf`;
  if (withExtension.length <= MAX_FILENAME_LENGTH) return withExtension;
  return `${withExtension.slice(0, MAX_FILENAME_LENGTH - 4)}.pdf`;
}

export function validatePdfUpload(
  file: { name: string; type: string; size: number },
  head: Uint8Array,
) {
  const maxBytes = getEnv().MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (file.size === 0) throw AppError.validation("The uploaded file is empty");
  if (file.size > maxBytes) {
    throw new AppError(
      "payload_too_large",
      `File exceeds the ${getEnv().MAX_UPLOAD_SIZE_MB} MB upload limit`,
      413,
    );
  }
  const looksLikePdf = new TextDecoder().decode(head.slice(0, 1024)).includes("%PDF-");
  const typeAllowed = ["", "application/pdf", "application/octet-stream"].includes(file.type);
  if (!/\.pdf$/i.test(file.name) || !typeAllowed || !looksLikePdf) {
    throw new AppError("unsupported_media_type", "Only PDF files are accepted", 415);
  }
}

function isFreshlyProcessing(record: DocumentRecord): boolean {
  return (
    (record.status === "processing" || record.status === "queued") &&
    Date.now() - record.updatedAt.getTime() < STALE_PROCESSING_MS
  );
}

// The app holds one report at a time: a new upload removes every other document and its data first.
export async function clearOtherDocuments(keepId?: string): Promise<void> {
  const others = (await listDocuments()).filter((d) => d._id !== keepId);
  const busy = others.find(isFreshlyProcessing);
  if (busy) {
    throw AppError.conflict(
      `"${busy.filename}" is still processing. Wait for it to finish before uploading another report.`,
    );
  }
  for (const document of others) await deleteDocument(document._id);
  await purgeOrphanedData(keepId);
}

// A job that was running when its document was deleted can leave chunks behind.
async function purgeOrphanedData(keepId?: string): Promise<void> {
  const remaining = (await listDocuments()).map((d) => d._id);
  if (keepId && !remaining.includes(keepId)) remaining.push(keepId);
  const filter = { documentId: { $nin: remaining } };
  const [chunks, sections, postings, stats] = await Promise.all([
    chunksCollection(),
    sectionsCollection(),
    postingsCollection(),
    statsCollection(),
  ]);
  await Promise.all([
    chunks.deleteMany(filter),
    sections.deleteMany(filter),
    postings.deleteMany(filter),
    stats.deleteMany({ _id: { $nin: remaining } }),
  ]);
}

export async function createDocumentFromUpload(
  filename: string,
  data: Buffer,
  strategy?: ChunkingStrategy,
): Promise<DocumentRecord> {
  const documents = await documentsCollection();
  const fileHash = createHash("sha256").update(data).digest("hex");
  const existing = await documents.findOne({ fileHash });
  await clearOtherDocuments(existing?._id);
  if (existing) return markForReprocessing(existing._id, strategy);

  const now = new Date();
  const record: DocumentRecord = {
    _id: randomUUID(),
    filename,
    fileHash,
    fileSize: data.length,
    pageCount: 0,
    chunkingStrategy: strategy,
    status: "queued",
    stage: "Queued",
    progress: 0,
    chunkCount: 0,
    sectionCount: 0,
    tableCount: 0,
    embeddingModel: null,
    embeddingDimensions: null,
    warnings: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    processedAt: null,
  };
  try {
    await documents.insertOne(record);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw AppError.conflict("This file was already uploaded");
    }
    throw error;
  }
  try {
    await saveOriginalPdf(record._id, data);
  } catch (error) {
    await documents.deleteOne({ _id: record._id });
    throw error;
  }
  return record;
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const documents = await documentsCollection();
  return documents.find({}).sort({ createdAt: -1 }).toArray();
}

export async function getDocumentOrThrow(id: string): Promise<DocumentRecord> {
  const documents = await documentsCollection();
  const record = await documents.findOne({ _id: id });
  if (!record) throw AppError.notFound("Document not found");
  return record;
}

export async function markForReprocessing(
  id: string,
  strategy?: ChunkingStrategy,
): Promise<DocumentRecord> {
  const record = await getDocumentOrThrow(id);
  if (isFreshlyProcessing(record))
    throw AppError.conflict("This document is already being processed");
  const documents = await documentsCollection();
  await documents.updateOne(
    { _id: id },
    {
      $set: {
        status: "queued",
        stage: "Queued",
        progress: 0,
        error: null,
        updatedAt: new Date(),
        ...(strategy ? { chunkingStrategy: strategy } : {}),
      },
    },
  );
  return getDocumentOrThrow(id);
}

export async function deleteDocument(id: string): Promise<void> {
  await getDocumentOrThrow(id);
  const [chunks, sections, evalRuns, documents] = await Promise.all([
    chunksCollection(),
    sectionsCollection(),
    evalRunsCollection(),
    documentsCollection(),
  ]);
  await Promise.all([
    chunks.deleteMany({ documentId: id }),
    sections.deleteMany({ documentId: id }),
    evalRuns.deleteMany({ documentId: id }),
    deleteBm25Index(id),
    deleteOriginalPdf(id),
  ]);
  await documents.deleteOne({ _id: id });
}
