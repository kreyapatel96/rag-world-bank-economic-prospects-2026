export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

export interface DocumentRecord {
  _id: string;
  filename: string;
  fileHash: string;
  fileSize: number;
  pageCount: number;
  chunkingStrategy?: string;
  techniques?: string[];
  status: DocumentStatus;
  stage: string;
  progress: number;
  chunkCount: number;
  sectionCount: number;
  tableCount: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  warnings: string[];
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export interface SectionRecord {
  _id: string;
  documentId: string;
  level: 1 | 2 | 3;
  title: string;
  chapterTitle: string;
  parentId: string | null;
  pageStart: number;
  pageEnd: number;
  order: number;
  tokenCount: number;
}

export interface TableMetadata {
  headers: string[];
  rowCount: number;
  note?: string;
}

export interface ChunkRecord {
  _id: string;
  documentId: string;
  text: string;
  embedding: number[];
  embeddingModel: string;
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  sectionId: string;
  pageStart: number;
  pageEnd: number;
  order: number;
  charCount: number;
  tokenCount: number;
  kind: "text" | "table";
  table?: TableMetadata;
}

export type StoredChunk = Omit<ChunkRecord, "embedding">;
export type DraftChunk = Omit<StoredChunk, "embeddingModel">;

export interface PostingRecord {
  _id: string;
  documentId: string;
  term: string;
  df: number;
  postings: { chunkId: string; tf: number }[];
}

export interface Bm25StatsRecord {
  _id: string;
  chunkCount: number;
  averageLength: number;
  lengths: Record<string, number>;
}

export interface EvalRunRecord {
  _id: string;
  documentId: string;
  createdAt: Date;
  report: unknown;
}
