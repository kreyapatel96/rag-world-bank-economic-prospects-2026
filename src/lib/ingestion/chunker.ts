import { estimateTokens } from "@/lib/context/tokens";
import type { DraftChunk, SectionRecord } from "@/lib/db/schemas";
import { packUnits, type ChunkingStrategy, type PackingOptions, type Unit } from "./strategies";
import type { Block, PageBreak } from "./types";

export interface ChunkingOptions extends PackingOptions {
  strategy: ChunkingStrategy;
}

export interface ChunkingResult {
  sections: SectionRecord[];
  chunks: DraftChunk[];
}

interface OpenSection {
  record: SectionRecord;
  title: string;
}

const ABBREVIATION_END =
  /(\b(?:e\.g|i\.e|etc|vs|No|Nos|Fig|Figs|approx|est|Inc|Ltd|Dr|Mr|Ms|St|al|cf|resp|incl|[A-Z])\.|\b[A-Z]\.[A-Z]\.)$/;
const SENTENCE_BOUNDARY = /(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[\p{Lu}\d])/u;

export function pageAt(breaks: PageBreak[], offset: number): number {
  let page = breaks[0]?.page ?? 0;
  for (const b of breaks) {
    if (b.offset <= offset) page = b.page;
    else break;
  }
  return page;
}

function splitSentences(text: string): { text: string; offset: number }[] {
  const parts = text.split(SENTENCE_BOUNDARY);
  const sentences: { text: string; offset: number }[] = [];
  let cursor = 0;
  for (const part of parts) {
    const offset = text.indexOf(part, cursor);
    cursor = offset + part.length;
    const previous = sentences[sentences.length - 1];
    if (previous && ABBREVIATION_END.test(previous.text)) previous.text += ` ${part}`;
    else sentences.push({ text: part, offset });
  }
  return sentences;
}

// Only reached for a single sentence larger than the hard limit: prefer clause boundaries over words.
function splitLongText(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const clauses = text.split(/(?<=[;:,])\s+/);
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current) pieces.push(current);
    current = "";
  };
  for (const clause of clauses) {
    const candidate = current ? `${current} ${clause}` : clause;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }
    push();
    if (estimateTokens(clause) <= maxTokens) {
      current = clause;
      continue;
    }
    let words: string[] = [];
    for (const word of clause.split(/\s+/)) {
      words.push(word);
      if (estimateTokens(words.join(" ")) >= maxTokens) {
        pieces.push(words.join(" "));
        words = [];
      }
    }
    current = words.join(" ");
  }
  push();
  return pieces;
}

function paragraphToUnits(block: Extract<Block, { type: "paragraph" }>, maxTokens: number): Unit[] {
  const units: Unit[] = [];
  let first = true;
  for (const sentence of splitSentences(block.text)) {
    const page = pageAt(block.breaks, sentence.offset);
    for (const piece of splitLongText(sentence.text, maxTokens)) {
      units.push({ text: piece, page, paragraphStart: first, tokens: estimateTokens(piece) });
      first = false;
    }
  }
  return units;
}

function joinUnits(units: Unit[]): string {
  return units.reduce((text, unit, index) => {
    if (index === 0) return unit.text;
    return `${text}${unit.paragraphStart ? "\n\n" : " "}${unit.text}`;
  }, "");
}

function tableRows(headers: string[], rows: string[][]): string[] {
  return rows
    .map((row) => {
      const label = row[0] ?? "";
      const values = row
        .slice(1)
        .map((value, i) => (value ? `${headers[i + 1] || `Column ${i + 2}`}: ${value}` : ""))
        .filter(Boolean);
      return `- ${[label, ...values].filter(Boolean).join(" | ")}`;
    })
    .filter((line) => line !== "- ");
}

export function tableToChunkTexts(
  block: Extract<Block, { type: "table" }>,
  maxTokens: number,
): { text: string; rowCount: number }[] {
  const preamble = [
    `Table: ${block.caption || "Untitled table"}`,
    `Columns: ${block.headers.join(" | ")}`,
    ...(block.note ? [`Extraction note: ${block.note}`] : []),
  ].join("\n");
  const preambleTokens = estimateTokens(preamble);
  const groups: { rows: string[]; count: number }[] = [];
  let current = { rows: [] as string[], count: 0 };
  let tokens = preambleTokens;
  const lines = tableRows(block.headers, block.rows);
  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (current.rows.length > 0 && tokens + lineTokens > maxTokens) {
      groups.push(current);
      current = { rows: [], count: 0 };
      tokens = preambleTokens;
    }
    current.rows.push(line);
    current.count++;
    tokens += lineTokens;
  }
  if (current.rows.length > 0) groups.push(current);
  return groups.map((g) => ({ text: `${preamble}\n${g.rows.join("\n")}`, rowCount: g.count }));
}

export function applyFallbackHeadings(blocks: Block[], windowSize: number): Block[] {
  const result: Block[] = [];
  let currentWindow = -1;
  for (const block of blocks) {
    if (block.type === "heading") continue;
    const page = block.type === "paragraph" ? block.pageStart : block.page;
    const window = Math.floor((page - 1) / windowSize);
    if (window !== currentWindow) {
      currentWindow = window;
      const start = window * windowSize + 1;
      result.push({
        type: "heading",
        level: 1,
        text: `Pages ${start}-${start + windowSize - 1}`,
        page,
      });
    }
    result.push(block);
  }
  return result;
}

export function buildHierarchy(
  documentId: string,
  blocks: Block[],
  options: ChunkingOptions,
  documentTitle: string,
): ChunkingResult {
  const sections: SectionRecord[] = [];
  const chunks: DraftChunk[] = [];
  const stack: (OpenSection | undefined)[] = [undefined, undefined, undefined];
  let current: OpenSection | undefined;
  let pending: Unit[] = [];

  const newSection = (level: 1 | 2 | 3, title: string, page: number): OpenSection => {
    const parent = [...stack.slice(0, level - 1)].reverse().find(Boolean);
    const record: SectionRecord = {
      _id: `${documentId}-s${sections.length}`,
      documentId,
      level,
      title,
      chapterTitle: level === 1 ? title : (stack[0]?.title ?? documentTitle),
      parentId: parent?.record._id ?? null,
      pageStart: page,
      pageEnd: page,
      order: sections.length,
      tokenCount: 0,
    };
    sections.push(record);
    const open = { record, title };
    for (let i = level - 1; i < 3; i++) stack[i] = i === level - 1 ? open : undefined;
    return open;
  };

  const pushChunk = (
    section: OpenSection,
    text: string,
    pageStart: number,
    pageEnd: number,
    kind: "text" | "table",
    table?: DraftChunk["table"],
  ) => {
    const order = chunks.length;
    const tokens = estimateTokens(text);
    chunks.push({
      _id: `${documentId}-c${order}`,
      documentId,
      text,
      chapterTitle: stack[0]?.title ?? documentTitle,
      sectionTitle: stack[1]?.title ?? "",
      subsectionTitle: stack[2]?.title ?? "",
      sectionId: section.record._id,
      pageStart,
      pageEnd,
      order,
      charCount: text.length,
      tokenCount: tokens,
      kind,
      table,
    });
    section.record.tokenCount += tokens;
    for (const open of stack) {
      if (open) open.record.pageEnd = Math.max(open.record.pageEnd, pageEnd);
    }
  };

  const flushText = () => {
    if (!current || pending.length === 0) {
      pending = [];
      return;
    }
    for (const group of packUnits(options.strategy, pending, options)) {
      const pages = group.map((u) => u.page);
      pushChunk(current, joinUnits(group), Math.min(...pages), Math.max(...pages), "text");
    }
    pending = [];
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flushText();
      current = newSection(block.level, block.text, block.page);
      continue;
    }
    if (!current) {
      current = newSection(
        1,
        documentTitle,
        block.type === "paragraph" ? block.pageStart : block.page,
      );
    }
    if (block.type === "paragraph") {
      pending.push(...paragraphToUnits(block, options.maxTokens));
      continue;
    }
    flushText();
    for (const part of tableToChunkTexts(block, options.maxTokens)) {
      pushChunk(current, part.text, block.page, block.page, "table", {
        headers: block.headers,
        rowCount: part.rowCount,
        note: block.note,
      });
    }
  }
  flushText();

  return { sections, chunks };
}

const SENTENCE_END = /[.!?:;]["'”’)\]]*$/;

export function countIncompleteChunks(chunks: DraftChunk[]): number {
  return chunks.filter((c) => c.kind === "text" && !SENTENCE_END.test(c.text.trim())).length;
}
