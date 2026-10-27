import { getEnv } from "@/lib/config/env";
import { chunksCollection, documentsCollection, sectionsCollection } from "@/lib/db/collections";
import { inspectVectorIndex } from "@/lib/db/indexes";
import type { ChunkRecord, DocumentRecord } from "@/lib/db/schemas";
import { embedInBatches } from "@/lib/embeddings/embedder";
import { errorMessage } from "@/lib/http/errors";
import { deleteBm25Index, replaceBm25Index } from "@/lib/retrieval/bm25";
import { buildSearchText } from "@/lib/retrieval/tokenizer";
import { applyFallbackHeadings, buildHierarchy, countIncompleteChunks } from "./chunker";
import { removeRunningHeadersAndFooters } from "./clean-pages";
import { extractPages } from "./extract-pdf";
import { readOriginalPdf } from "./storage";
import { isChunkingStrategy, STRATEGY_DESCRIPTIONS, type ChunkingStrategy } from "./strategies";
import { buildBlocks } from "./structure";

const MIN_HEADINGS_FOR_STRUCTURE = 2;
const FALLBACK_WINDOW_PAGES = 5;
const WRITE_BATCH = 200;

async function setProgress(
  documentId: string,
  stage: string,
  progress: number,
  extra?: Partial<DocumentRecord>,
) {
  const documents = await documentsCollection();
  const result = await documents.updateOne(
    { _id: documentId },
    { $set: { stage, progress, updatedAt: new Date(), ...extra } },
  );
  if (result.matchedCount === 0) throw new IngestionCancelled();
}

class IngestionCancelled extends Error {
  constructor() {
    super("Document was deleted while processing");
  }
}

async function removePartialData(documentId: string) {
  const [chunks, sections] = await Promise.all([chunksCollection(), sectionsCollection()]);
  await Promise.all([
    chunks.deleteMany({ documentId }),
    sections.deleteMany({ documentId }),
    deleteBm25Index(documentId),
  ]);
}

interface TechniqueFacts {
  strategy: ChunkingStrategy;
  windowSentences: number;
  pageCount: number;
  twoColumnPages: number;
  removedLines: number;
  headingCount: number;
  usedFallbackSections: boolean;
  tableCount: number;
  figureTextSkipped: number;
  sectionCount: number;
  chunkCount: number;
  incompleteChunks: number;
}

// Lists what was actually applied to this document, so the UI never claims a step that did not run.
function describeTechniques(f: TechniqueFacts): string[] {
  const list = [
    f.twoColumnPages > 0
      ? `Column-aware reading: ${f.twoColumnPages} of ${f.pageCount} pages read left column then right column`
      : "Column-aware reading: no two-column pages detected, all pages read as one column",
    f.removedLines > 0
      ? `Cleaning: removed ${f.removedLines} repeated header, footer and page-number lines`
      : "Cleaning: no repeated headers or footers found",
    f.usedFallbackSections
      ? "Structure: too few headings found, sections are 5-page windows"
      : `Structure: ${f.headingCount} headings detected, ${f.sectionCount} sections (chapter > section > subsection)`,
    `Chunking (${f.strategy}): ${STRATEGY_DESCRIPTIONS[f.strategy]}`,
    f.figureTextSkipped > 0
      ? `Figures: ${f.figureTextSkipped} blocks of chart axis labels and legends skipped; a sentence interrupted by a figure or page break is rejoined`
      : "Figures: no chart-label text found",
    f.incompleteChunks === 0
      ? "Sentences: every text chunk is made of whole sentences and ends at a sentence boundary"
      : `Sentences: chunks are built from whole sentences; ${f.incompleteChunks} of ${f.chunkCount} end without sentence punctuation (lists, captions, contents pages, tables)`,
    `Chunk metadata: chapter, section, subsection, page range and order on all ${f.chunkCount} chunks`,
    f.tableCount > 0
      ? `Tables: ${f.tableCount} detected and stored as row-wise chunks with column headers repeated`
      : "Tables: none detected",
    "Indexing: embeddings for semantic search plus a BM25 keyword index, fused with Reciprocal Rank Fusion at query time",
  ];
  if (f.strategy === "sentence_window")
    list.splice(4, 0, `Window size: ${f.windowSentences} sentences`);
  return list;
}

function documentTitle(filename: string): string {
  return (
    filename
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Document"
  );
}

export async function runIngestion(documentId: string): Promise<void> {
  const documents = await documentsCollection();
  try {
    const record = await documents.findOne({ _id: documentId });
    if (!record) return;
    const env = getEnv();
    const warnings: string[] = [];

    await setProgress(documentId, "Reading PDF", 3, {
      status: "processing",
      error: null,
      warnings: [],
    });
    const data = await readOriginalPdf(documentId);

    await setProgress(documentId, "Extracting text", 8);
    const rawPages = await extractPages(new Uint8Array(data));
    const extractedChars = rawPages.reduce(
      (n, p) => n + p.lines.reduce((m, l) => m + l.text.length, 0),
      0,
    );
    if (extractedChars < 200) {
      throw new Error("No extractable text found. The PDF may be scanned; OCR is not supported.");
    }

    await setProgress(documentId, "Cleaning pages", 20, { pageCount: rawPages.length });
    const { pages, removedLines } = removeRunningHeadersAndFooters(rawPages);
    if (removedLines > 0)
      warnings.push(`Removed ${removedLines} repeated header, footer or page-number lines.`);

    await setProgress(documentId, "Detecting structure", 28);
    const structure = buildBlocks(pages);
    let blocks = structure.blocks;
    if (structure.headingCount < MIN_HEADINGS_FOR_STRUCTURE) {
      blocks = applyFallbackHeadings(blocks, FALLBACK_WINDOW_PAGES);
      warnings.push(
        `Fewer than ${MIN_HEADINGS_FOR_STRUCTURE} headings were detected; sections fall back to ${FALLBACK_WINDOW_PAGES}-page windows.`,
      );
    }
    if (structure.tableCount > 0) {
      warnings.push(
        `${structure.tableCount} table(s) were extracted heuristically; verify values against the source pages.`,
      );
    }

    const strategy = isChunkingStrategy(record.chunkingStrategy)
      ? record.chunkingStrategy
      : env.CHUNKING_STRATEGY;
    await setProgress(documentId, `Chunking (${strategy})`, 35, { chunkingStrategy: strategy });
    const { sections, chunks } = buildHierarchy(
      documentId,
      blocks,
      {
        strategy,
        windowSentences: env.CHUNK_WINDOW_SENTENCES,
        targetTokens: env.CHUNK_TARGET_TOKENS,
        maxTokens: Math.max(env.CHUNK_MAX_TOKENS, env.CHUNK_TARGET_TOKENS),
        overlapTokens: Math.min(env.CHUNK_OVERLAP_TOKENS, Math.floor(env.CHUNK_TARGET_TOKENS / 2)),
      },
      documentTitle(record.filename),
    );
    if (chunks.length === 0) throw new Error("No chunks were produced from the extracted text.");
    const incomplete = countIncompleteChunks(chunks);
    if (incomplete / chunks.length > 0.05) {
      warnings.push(
        `${incomplete} of ${chunks.length} chunks do not end at a sentence boundary (usually lists or headings without punctuation).`,
      );
    }
    const twoColumnPages = pages.filter((p) => p.twoColumn).length;

    const embedding = await embedInBatches(
      chunks.map((c) => buildSearchText(c)),
      "document",
      (done, total) =>
        setProgress(documentId, `Embedding ${done}/${total}`, 35 + Math.round((done / total) * 50)),
    );

    const index = await inspectVectorIndex(embedding.dimensions);
    if (index.state === "dimension_mismatch") throw new Error(index.message);
    if (index.state !== "ready") warnings.push(`Semantic search is not ready: ${index.message}`);

    await setProgress(documentId, "Writing to MongoDB", 88);
    const [chunkCol, sectionCol] = await Promise.all([chunksCollection(), sectionsCollection()]);
    await Promise.all([chunkCol.deleteMany({ documentId }), sectionCol.deleteMany({ documentId })]);
    await sectionCol.insertMany(sections);
    const stored: ChunkRecord[] = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: embedding.vectors[i] ?? [],
      embeddingModel: embedding.model,
    }));
    for (let i = 0; i < stored.length; i += WRITE_BATCH) {
      await chunkCol.insertMany(stored.slice(i, i + WRITE_BATCH));
    }

    await setProgress(documentId, "Building keyword index", 95);
    await replaceBm25Index(documentId, chunks);

    await setProgress(documentId, "Ready", 100, {
      status: "ready",
      chunkCount: chunks.length,
      sectionCount: sections.length,
      tableCount: structure.tableCount,
      techniques: describeTechniques({
        strategy,
        windowSentences: env.CHUNK_WINDOW_SENTENCES,
        pageCount: pages.length,
        twoColumnPages,
        removedLines,
        headingCount: structure.headingCount,
        usedFallbackSections: structure.headingCount < MIN_HEADINGS_FOR_STRUCTURE,
        tableCount: structure.tableCount,
        figureTextSkipped: structure.figureTextSkipped,
        sectionCount: sections.length,
        chunkCount: chunks.length,
        incompleteChunks: incomplete,
      }),
      embeddingModel: embedding.model,
      embeddingDimensions: embedding.dimensions,
      warnings,
      processedAt: new Date(),
    });
  } catch (error) {
    if (error instanceof IngestionCancelled) {
      await removePartialData(documentId).catch(() => undefined);
      return;
    }
    console.error(`Ingestion failed for ${documentId}:`, errorMessage(error));
    await setProgress(documentId, "Failed", 0, {
      status: "failed",
      error: errorMessage(error).slice(0, 500),
    }).catch(() => undefined);
  }
}
