import type { ColumnId, TextItem } from "./types";

export interface ItemRow {
  items: TextItem[];
  column: ColumnId;
}

export interface PageLayout {
  rows: ItemRow[];
  twoColumn: boolean;
}

const ROW_Y_TOLERANCE = 2.5;
const GUTTER_SEARCH = { from: 0.3, to: 0.7 };
const MAX_CROSSING_RATIO = 0.03;
const MIN_GUTTER_WIDTH = 6;
const MIN_SIDE_LINES = 8;
const MIN_SIDE_LINE_CHARS = 25;

function groupRows(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs((r[0]?.y ?? 0) - item.y) <= ROW_Y_TOLERANCE);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

const hasText = (item: TextItem) => item.str.trim().length > 0;
const center = (item: TextItem) => item.x + item.width / 2;
const crosses = (item: TextItem, gutter: number) =>
  item.x < gutter - 1 && item.x + item.width > gutter + 1;

function findGutter(items: TextItem[], pageWidth: number): number | null {
  if (items.length < 24) return null;
  const allowed = Math.max(1, Math.floor(items.length * MAX_CROSSING_RATIO));
  let best: { start: number; end: number } | null = null;
  let current: { start: number; end: number } | null = null;
  const from = Math.floor(pageWidth * GUTTER_SEARCH.from);
  const to = Math.ceil(pageWidth * GUTTER_SEARCH.to);
  for (let x = from; x <= to; x++) {
    const crossing = items.filter((item) => crosses(item, x)).length;
    if (crossing <= allowed) {
      current = current ? { start: current.start, end: x } : { start: x, end: x };
      if (!best || current.end - current.start > best.end - best.start) best = { ...current };
    } else {
      current = null;
    }
  }
  if (!best || best.end - best.start < MIN_GUTTER_WIDTH) return null;
  return (best.start + best.end) / 2;
}

function looksLikeTwoColumnText(rows: TextItem[][], gutter: number): boolean {
  const left: number[] = [];
  const right: number[] = [];
  for (const row of rows) {
    const l = row.filter((i) => center(i) < gutter);
    const r = row.filter((i) => center(i) >= gutter);
    const chars = (side: TextItem[]) => side.reduce((n, i) => n + i.str.trim().length, 0);
    if (l.length > 0) left.push(chars(l));
    if (r.length > 0) right.push(chars(r));
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
  return (
    left.length >= MIN_SIDE_LINES &&
    right.length >= MIN_SIDE_LINES &&
    mean(left) >= MIN_SIDE_LINE_CHARS &&
    mean(right) >= MIN_SIDE_LINE_CHARS
  );
}

export function arrangeRows(allItems: TextItem[], pageWidth: number): PageLayout {
  const items = allItems.filter(hasText);
  const rows = groupRows(items);
  const gutter = findGutter(items, pageWidth);
  if (gutter === null || !looksLikeTwoColumnText(rows, gutter)) {
    return { rows: rows.map((row) => ({ items: row, column: 0 as const })), twoColumn: false };
  }

  const arranged: ItemRow[] = [];
  let leftBuffer: TextItem[][] = [];
  let rightBuffer: TextItem[][] = [];
  const flush = () => {
    for (const row of leftBuffer) arranged.push({ items: row, column: 1 });
    for (const row of rightBuffer) arranged.push({ items: row, column: 2 });
    leftBuffer = [];
    rightBuffer = [];
  };

  for (const row of rows) {
    if (row.some((item) => crosses(item, gutter))) {
      flush();
      arranged.push({ items: row, column: 0 });
      continue;
    }
    const left = row.filter((i) => center(i) < gutter);
    const right = row.filter((i) => center(i) >= gutter);
    if (left.length > 0) leftBuffer.push(left);
    if (right.length > 0) rightBuffer.push(right);
  }
  flush();
  return { rows: arranged, twoColumn: true };
}
