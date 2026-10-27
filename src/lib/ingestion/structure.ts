import { segmentPage, type Segment } from "./tables";
import type { Block, ColumnId, PageBreak, PageContent, PageLine } from "./types";

export interface StructureResult {
  blocks: Block[];
  headingCount: number;
  tableCount: number;
  figureTextSkipped: number;
}

const CHAPTER_PATTERN = /^(chapter|part)\s+(\d+|[ivxlc]+)\b/i;
const BARE_CHAPTER_PATTERN = /^(chapter|part)\s+(\d+|[ivxlc]+)\s*[:.]?$/i;
const NUMBERED_HEADING = /^\d+(\.\d+)+\.?\s+\p{Lu}/u;
const BULLET_START = /^([•▪●■◦·]|[-–—]\s|\(?\d{1,2}[.)]\s|\([a-z]\)\s)/;
const SENTENCE_END = /[.!?:;]["')\]]?$/;
const DOT_LEADER = /\.{4,}/;

const HEADING_SIZE_RATIO = 1.12;
const MIN_RANKED_SIZE_OCCURRENCES = 3;
const MAX_HEADING_WORDS = 25;

interface HeadingCandidate {
  text: string;
  fontSize: number;
  level: 1 | 2 | 3 | null;
}

const roundSize = (size: number) => Math.round(size * 2) / 2;

const MIN_BODY_LINE_CHARS = 20;
const SMALL_TEXT_RATIO = 0.85;
const NOTE_START = /^(source|sources|note|notes)\b/i;
const NUMERIC_TOKEN = /^[\d.,%+\-–−()$]+$/;
const MAX_SIZE_HEADING_CHARS = 110;
const MAX_HEADING_LINES = 3;

function dominantSize(lines: PageLine[], minChars: number): number | null {
  const weight = new Map<number, number>();
  for (const line of lines) {
    if (line.text.length < minChars) continue;
    const size = roundSize(line.fontSize);
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  let best: number | null = null;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

function documentBodySize(pages: PageContent[]): number {
  return (
    dominantSize(
      pages.flatMap((p) => p.lines),
      MIN_BODY_LINE_CHARS,
    ) ?? 10
  );
}

function isTocPage(lines: PageLine[]): boolean {
  if (lines.some((l) => /^(table of )?contents$/i.test(l.text.trim()))) return true;
  const leaders = lines.filter((l) => DOT_LEADER.test(l.text)).length;
  return lines.length > 0 && leaders / lines.length >= 0.3;
}

function isAllCapsHeading(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  const words = text.split(/\s+/).length;
  return (
    letters.length >= 4 && words <= 12 && letters === letters.toUpperCase() && !/[.;,]$/.test(text)
  );
}

function classifyLine(line: PageLine, body: number): { heading: boolean; chapter: boolean } {
  const text = line.text.trim();
  const words = text.split(/\s+/).length;
  if ((text.match(/\p{L}/gu) ?? []).length < 3) return { heading: false, chapter: false };
  if (words > MAX_HEADING_WORDS || text.length > 160 || DOT_LEADER.test(text)) {
    return { heading: false, chapter: false };
  }
  if (CHAPTER_PATTERN.test(text) && words <= 14) return { heading: true, chapter: true };
  const larger = line.fontSize >= body * HEADING_SIZE_RATIO;
  if (
    larger &&
    text.length <= MAX_SIZE_HEADING_CHARS &&
    !/[,;]$/.test(text) &&
    !/^\d+$/.test(text)
  ) {
    return { heading: true, chapter: false };
  }
  if (NUMBERED_HEADING.test(text) && words <= 14 && !/[.,;]$/.test(text)) {
    return { heading: true, chapter: false };
  }
  if (isAllCapsHeading(text) && line.cells.length === 1) return { heading: true, chapter: false };
  return { heading: false, chapter: false };
}

function rankSizes(candidates: HeadingCandidate[], chapterSize: number | null): number[] {
  const counts = new Map<number, number>();
  for (const c of candidates) {
    const size = roundSize(c.fontSize);
    if (chapterSize !== null && size >= chapterSize - 0.5) continue;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  let sizes = [...counts.entries()]
    .filter(([, n]) => n >= MIN_RANKED_SIZE_OCCURRENCES)
    .map(([s]) => s);
  if (sizes.length < 2) sizes = [...counts.keys()];
  return sizes.sort((a, b) => b - a);
}

function levelForSize(size: number, ranked: number[], offset: number): 1 | 2 | 3 {
  if (ranked.length === 0) return Math.min(1 + offset, 3) as 1 | 2 | 3;
  let bestIndex = 0;
  let bestDiff = Infinity;
  ranked.forEach((s, index) => {
    const diff = Math.abs(s - roundSize(size));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  return Math.min(bestIndex + 1 + offset, 3) as 1 | 2 | 3;
}

function numberedLevel(text: string): 2 | 3 {
  const depth = (text.match(/^\d+((?:\.\d+)+)/)?.[1] ?? "").split(".").length - 1;
  return depth >= 2 ? 3 : 2;
}

class ParagraphBuilder {
  private text = "";
  private breaks: PageBreak[] = [];
  private lastLine: PageLine | null = null;
  private lastPage = 0;
  private lastWidth = 0;
  private allSmall = true;
  skippedFigureText = 0;

  constructor(private readonly emit: (block: Block) => void) {}

  get isOpen() {
    return this.text.length > 0;
  }

  get endsSentence() {
    return SENTENCE_END.test(this.text);
  }

  add(line: PageLine, page: number, pageMaxWidth: number, lineSpacing: number, body: number) {
    const lineText = line.text.replace(/\.{4,}/g, " … ").trim();
    const width = (line.cells[line.cells.length - 1]?.x1 ?? line.x0) - line.x0;
    if (this.isOpen && this.shouldBreak(line, lineText, page, lineSpacing, pageMaxWidth))
      this.flush();

    if (!this.isOpen) {
      this.text = lineText;
      this.breaks = [{ offset: 0, page }];
      this.allSmall = true;
    } else {
      const hyphenated = /[a-z]-$/.test(this.text) && /^[a-z]/.test(lineText);
      const joiner = hyphenated ? "" : " ";
      if (hyphenated) this.text = this.text.slice(0, -1);
      const offset = this.text.length + joiner.length;
      this.text += joiner + lineText;
      if (page !== this.lastPage) this.breaks.push({ offset, page });
    }
    if (line.fontSize > body * SMALL_TEXT_RATIO) this.allSmall = false;
    this.lastLine = line;
    this.lastPage = page;
    this.lastWidth = width;
  }

  private shouldBreak(
    line: PageLine,
    text: string,
    page: number,
    lineSpacing: number,
    pageMaxWidth: number,
  ) {
    const previous = this.lastLine;
    if (!previous) return false;
    if (BULLET_START.test(text)) return true;
    if (page !== this.lastPage) return this.endsSentence;
    const gap = previous.y - line.y;
    if (gap > Math.max(lineSpacing * 1.45, line.fontSize * 1.7)) return true;
    if (this.endsSentence && this.lastWidth < pageMaxWidth * 0.7) return true;
    return false;
  }

  // Chart axis labels and legends come out as short runs of numbers or small unpunctuated words.
  private isFigureText(): boolean {
    if (/^\d{1,3}$/.test(this.text.trim())) return true;
    const tokens = this.text.split(/\s+/);
    const numeric = tokens.filter((t) => NUMERIC_TOKEN.test(t)).length;
    if (tokens.length >= 4 && numeric / tokens.length >= 0.6) return true;
    return this.allSmall && !NOTE_START.test(this.text) && !SENTENCE_END.test(this.text);
  }

  flush() {
    if (!this.isOpen) return;
    if (this.isFigureText()) {
      this.skippedFigureText++;
      this.text = "";
      this.breaks = [];
      this.lastLine = null;
      return;
    }
    const pageStart = this.breaks[0]?.page ?? 0;
    const pageEnd = this.breaks[this.breaks.length - 1]?.page ?? pageStart;
    this.emit({ type: "paragraph", text: this.text, breaks: this.breaks, pageStart, pageEnd });
    this.text = "";
    this.breaks = [];
    this.lastLine = null;
  }
}

function maxWidthByColumn(lines: PageLine[]): Record<ColumnId, number> {
  const widths: Record<ColumnId, number> = { 0: 1, 1: 1, 2: 1 };
  for (const line of lines) {
    const width = (line.cells[line.cells.length - 1]?.x1 ?? line.x0) - line.x0;
    widths[line.column] = Math.max(widths[line.column], width);
  }
  return widths;
}

function medianLineSpacing(lines: PageLine[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = (lines[i - 1]?.y ?? 0) - (lines[i]?.y ?? 0);
    if (gap > 0 && gap < 40) gaps.push(gap);
  }
  if (gaps.length === 0) return 12;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 12;
}

const CAPTION_OR_NOTE = /^(figure|table|box|source|sources|note|notes|annex)\b/i;
const MAX_STANDALONE_HEADING_CHARS = 70;
const MAX_STANDALONE_HEADING_WORDS = 9;

// Bold subheadings share the body font size. A short unpunctuated line that stands between two
// complete paragraphs is a subheading, not a sentence fragment.
export function promoteStandaloneHeadings(blocks: Block[]): Block[] {
  return blocks.map((block, index) => {
    if (block.type !== "paragraph" || block.pageStart !== block.pageEnd) return block;
    const text = block.text.trim();
    const words = text.split(/\s+/).length;
    if (text.length < 4 || text.length > MAX_STANDALONE_HEADING_CHARS) return block;
    if (words > MAX_STANDALONE_HEADING_WORDS || !/^\p{Lu}/u.test(text)) return block;
    if (/[.!?:;,]$/.test(text) || CAPTION_OR_NOTE.test(text)) return block;
    const previous = blocks[index - 1];
    const next = blocks[index + 1];
    const afterBoundary =
      previous === undefined ||
      previous.type !== "paragraph" ||
      SENTENCE_END.test(previous.text.trim());
    const beforeProse = next?.type === "paragraph" && /^\p{Lu}/u.test(next.text.trim());
    if (!afterBoundary || !beforeProse) return block;
    return { type: "heading", level: 3, text, page: block.pageStart };
  });
}

// A sentence cut by a figure, a column jump or a page break continues in the next paragraph block,
// which then starts in lower case. Joining them keeps the sentence in one chunk.
export function mergeBrokenParagraphs(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    const continues =
      block.type === "paragraph" &&
      last?.type === "paragraph" &&
      !SENTENCE_END.test(last.text) &&
      /^[\p{Ll}\d(]/u.test(block.text);
    if (!continues || block.type !== "paragraph" || last?.type !== "paragraph") {
      merged.push(block);
      continue;
    }
    const hyphenated = /[a-z]-$/.test(last.text) && /^[a-z]/.test(block.text);
    const base = hyphenated ? last.text.slice(0, -1) : last.text;
    const joiner = hyphenated ? "" : " ";
    const offset = base.length + joiner.length;
    merged[merged.length - 1] = {
      ...last,
      text: base + joiner + block.text,
      breaks: [...last.breaks, ...block.breaks.map((b) => ({ ...b, offset: b.offset + offset }))],
      pageEnd: block.pageEnd,
    };
  }
  return merged;
}

export function buildBlocks(pages: PageContent[]): StructureResult {
  const blocks: Block[] = [];

  const globalBody = documentBodySize(pages);
  const pageSegments = pages.map((page) => {
    const toc = isTocPage(page.lines);
    // A page dominated by small figure notes must not make normal text look like headings.
    const body = Math.max(dominantSize(page.lines, MIN_BODY_LINE_CHARS) ?? 0, globalBody);
    const segments: Segment[] = toc
      ? page.lines.map((line) => ({ type: "line", line }))
      : segmentPage(page.lines);
    return { page, toc, body, segments };
  });

  const candidates: HeadingCandidate[] = [];
  const chapterSizes: number[] = [];
  for (const { toc, body, segments } of pageSegments) {
    if (toc) continue;
    segments.forEach((segment) => {
      if (segment.type !== "line") return;
      const result = classifyLine(segment.line, body);
      if (!result.heading) return;
      candidates.push({
        text: segment.line.text,
        fontSize: segment.line.fontSize,
        level: result.chapter ? 1 : null,
      });
      if (result.chapter) chapterSizes.push(roundSize(segment.line.fontSize));
    });
  }
  const chapterSize = chapterSizes.length > 0 ? Math.max(...chapterSizes) : null;
  const ranked = rankSizes(candidates, chapterSize);

  let headingCount = 0;
  let tableCount = 0;
  const paragraph = new ParagraphBuilder((block) => blocks.push(block));

  for (const { page, toc, body, segments } of pageSegments) {
    const maxWidths = maxWidthByColumn(page.lines);
    const spacing = medianLineSpacing(page.lines);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      if (segment.type === "table") {
        paragraph.flush();
        tableCount++;
        blocks.push({
          type: "table",
          caption: segment.caption,
          headers: segment.headers,
          rows: segment.rows,
          page: page.pageNumber,
          note: segment.note,
        });
        continue;
      }

      const line = segment.line;
      const result = toc ? { heading: false, chapter: false } : classifyLine(line, body);
      if (!result.heading) {
        paragraph.add(line, page.pageNumber, maxWidths[line.column], spacing, body);
        continue;
      }

      paragraph.flush();
      let text = line.text.trim();
      let size = line.fontSize;
      const isChapter = result.chapter;
      let lastY = line.y;
      let mergedLines = 1;
      while (i + 1 < segments.length && mergedLines < MAX_HEADING_LINES) {
        const next = segments[i + 1];
        if (next?.type !== "line") break;
        const nextResult = classifyLine(next.line, body);
        const sameSize = Math.abs(next.line.fontSize - size) < 0.6;
        const wrapped = sameSize && lastY - next.line.y <= next.line.fontSize * 1.9;
        const chapterTitle =
          BARE_CHAPTER_PATTERN.test(text) && lastY - next.line.y <= next.line.fontSize * 2.5;
        if (!nextResult.heading || (!wrapped && !chapterTitle) || nextResult.chapter) break;
        text = `${text} ${next.line.text.trim()}`.replace(/\s+/g, " ");
        if (chapterTitle) size = Math.max(size, next.line.fontSize);
        lastY = next.line.y;
        mergedLines++;
        i++;
      }

      const level: 1 | 2 | 3 = isChapter
        ? 1
        : NUMBERED_HEADING.test(text) && line.fontSize < body * HEADING_SIZE_RATIO
          ? numberedLevel(text)
          : levelForSize(size, ranked, chapterSize === null ? 0 : 1);
      headingCount++;
      blocks.push({ type: "heading", level, text, page: page.pageNumber });
    }
    if (paragraph.isOpen && paragraph.endsSentence) paragraph.flush();
  }
  paragraph.flush();
  return {
    blocks: mergeBrokenParagraphs(promoteStandaloneHeadings(blocks)),
    headingCount,
    tableCount,
    figureTextSkipped: paragraph.skippedFigureText,
  };
}
