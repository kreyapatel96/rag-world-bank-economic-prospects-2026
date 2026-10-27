import { GridFSBucket } from "mongodb";
import { getDb } from "@/lib/db/mongo";
import { AppError } from "@/lib/http/errors";

const BUCKET_NAME = "pdf_files";

async function bucket() {
  return new GridFSBucket(await getDb(), { bucketName: BUCKET_NAME });
}

export async function saveOriginalPdf(documentId: string, data: Buffer): Promise<void> {
  const files = await bucket();
  await new Promise<void>((resolve, reject) => {
    const stream = files.openUploadStream(documentId);
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.end(data);
  });
}

export async function readOriginalPdf(documentId: string): Promise<Buffer> {
  const files = await bucket();
  const chunks: Buffer[] = [];
  try {
    for await (const part of files.openDownloadStreamByName(documentId))
      chunks.push(part as Buffer);
  } catch {
    throw AppError.notFound("The original PDF is no longer stored; upload it again");
  }
  return Buffer.concat(chunks);
}

export async function deleteOriginalPdf(documentId: string): Promise<void> {
  const files = await bucket();
  const matches = await files.find({ filename: documentId }).toArray();
  await Promise.all(matches.map((file) => files.delete(file._id)));
}
