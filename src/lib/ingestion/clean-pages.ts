import type { PageContent, PageLine } from "./types";

const MARGIN_FRACTION = 0.09;
const REPEAT_THRESHOLD = 0.15;
const MIN_PAGES_FOR_REPEAT = 4;
const MIN_REPEAT_COUNT = 4;

const PAGE_NUMBER_PATTERN = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d{1,4})?$/i;

function inMargin(line: PageLine, pageHeight: number): boolean {
  return line.y > pageHeight * (1 - MARGIN_FRACTION) || line.y < pageHeight * MARGIN_FRACTION;
}

const KEY_LETTERS = 14;

// Footers vary in word order, letter-spacing, doubled glyphs and section names, so a line is
// identified by its first and last letters (spacing and digits ignored) as well as its letter set.
function signatures(text: string): string[] {
  const letters = text.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (letters.length === 0) return [];
  const keys = [`all:${[...letters].sort().join("")}`];
  if (letters.length >= KEY_LETTERS + 6) {
    keys.push(`start:${letters.slice(0, KEY_LETTERS)}`, `end:${letters.slice(-KEY_LETTERS)}`);
  }
  return keys;
}

export interface CleanResult {
  pages: PageContent[];
  removedLines: number;
}

export function removeRunningHeadersAndFooters(pages: PageContent[]): CleanResult {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      if (!inMargin(line, page.height)) continue;
      for (const key of signatures(line.text)) seen.add(key);
    }
    for (const sig of seen) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }

  const repeated = new Set<string>();
  if (pages.length >= MIN_PAGES_FOR_REPEAT) {
    for (const [sig, count] of counts) {
      if (sig.length > 0 && count >= MIN_REPEAT_COUNT && count / pages.length >= REPEAT_THRESHOLD) {
        repeated.add(sig);
      }
    }
  }

  let removedLines = 0;
  const cleaned = pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      if (!inMargin(line, page.height)) return true;
      const drop =
        PAGE_NUMBER_PATTERN.test(line.text.trim()) ||
        signatures(line.text).some((key) => repeated.has(key));
      if (drop) removedLines++;
      return !drop;
    }),
  }));
  return { pages: cleaned, removedLines };
}
