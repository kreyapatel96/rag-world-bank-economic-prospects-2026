import type { PageLine, TextCell } from "./types";

export type Segment =
  | { type: "line"; line: PageLine }
  | { type: "table"; caption: string; headers: string[]; rows: string[][]; note?: string };

// A number, optionally followed by a short unit ("0.27W", "91.1%", "346 kg CO2e").
const NUMERIC_CELL =
  /^[(\-–−+]?[$€£]?\d[\d,.]*(\s?[%a-zA-Z²₂]{1,6}(\s[A-Za-z0-9₂²]{1,6})?)?\)?$|^(\.\.|n\.?a\.?|–|—)$/i;
// Column labels such as "100V" or "256GB" are numbers with units but describe columns, not data.
const LABEL_CELL = /^\d{2,4}\s?[A-Za-z]{1,2}$/;
const YEAR_CELL = /^((19|20)\d{2}[a-z]?|fy\d{2,4}|\d{4}[-–/]\d{2,4})$/i;
const CAPTION = /^(table|figure|box|exhibit|annex table)\s+[\dA-Z][\dA-Z.\-]*\b/i;

const MIN_ROWS = 3;
const COLUMN_SLACK = 1.5;

const isNumeric = (cell: TextCell) => NUMERIC_CELL.test(cell.text.trim());
const isYear = (cell: TextCell) =>
  YEAR_CELL.test(cell.text.trim()) || LABEL_CELL.test(cell.text.trim());

function isCandidateRow(line: PageLine): boolean {
  return line.cells.length >= 2 && !/\.{4,}/.test(line.text);
}

function qualifiesAsTable(rows: PageLine[]): boolean {
  const numeric = rows.filter((r) => r.cells.some(isNumeric)).length;
  // Side-by-side columns of prose have no numbers; they are not tables.
  if (numeric / rows.length < 0.3) return false;
  const wide = rows.filter((r) => r.cells.length >= 3).length;
  if (wide / rows.length >= 0.5) return true;
  return rows.length >= 4 && numeric / rows.length >= 0.75;
}

function isHeaderRow(row: PageLine): boolean {
  const numeric = row.cells.filter(isNumeric);
  return numeric.length === 0 || numeric.every(isYear);
}

interface Interval {
  start: number;
  end: number;
}

function buildColumns(rows: PageLine[]): Interval[] {
  const bodyRows = rows.filter((r) => !isHeaderRow(r));
  const source = bodyRows.length > 0 ? bodyRows : rows;
  const intervals = source
    .flatMap((r) => r.cells.map((c) => ({ start: c.x0, end: c.x1 })))
    .sort((a, b) => a.start - b.start);
  const columns: Interval[] = [];
  for (const interval of intervals) {
    const last = columns[columns.length - 1];
    if (last && interval.start <= last.end + COLUMN_SLACK)
      last.end = Math.max(last.end, interval.end);
    else columns.push({ ...interval });
  }
  return columns;
}

function columnIndex(cell: TextCell, columns: Interval[]): number {
  let best = 0;
  let bestOverlap = -Infinity;
  columns.forEach((column, index) => {
    const overlap = Math.min(cell.x1, column.end) - Math.max(cell.x0, column.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = index;
    }
  });
  return best;
}

function placeRow(row: PageLine, columns: Interval[]): string[] {
  const values = columns.map(() => "");
  for (const cell of row.cells) {
    const index = columnIndex(cell, columns);
    values[index] = values[index] ? `${values[index]} ${cell.text}` : cell.text;
  }
  return values;
}

function buildTable(rows: PageLine[]) {
  const columns = buildColumns(rows);
  const placed = rows.map((row) => ({ values: placeRow(row, columns), header: isHeaderRow(row) }));

  const headerRows: string[][] = [];
  let index = 0;
  while (index < placed.length && placed[index]?.header) {
    headerRows.push(placed[index]?.values ?? []);
    index++;
  }
  // Key-value tables whose values carry units ("346 kg CO2e") look like all header rows; keep the
  // first row as the header and the rest as data instead of dropping them.
  if (index === placed.length && placed.length > 1) {
    headerRows.length = 1;
    index = 1;
  }
  const bodyRows = placed.slice(index).map((r) => r.values);

  let note: string | undefined;
  const headers =
    headerRows.length > 0
      ? columns.map((_, c) =>
          headerRows
            .map((r) => r[c] ?? "")
            .filter(Boolean)
            .join(" "),
        )
      : columns.map((_, c) => `Column ${c + 1}`);
  if (headerRows.length === 0) note = "No header row was detected; columns are numbered.";

  const cellCount = bodyRows.reduce((n, r) => n + r.length, 0);
  const filled = bodyRows.reduce((n, r) => n + r.filter(Boolean).length, 0);
  if (cellCount > 0 && filled / cellCount < 0.6) {
    note = `${note ? `${note} ` : ""}Column alignment is uncertain; verify values against the source page.`;
  }
  return { headers, rows: bodyRows, note };
}

export function segmentPage(lines: PageLine[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (!isCandidateRow(line)) {
      segments.push({ type: "line", line });
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && isCandidateRow(lines[end] as PageLine)) end++;
    const run = lines.slice(i, end);
    if (run.length >= MIN_ROWS && qualifiesAsTable(run)) {
      let caption = "";
      const previous = segments[segments.length - 1];
      if (previous?.type === "line" && CAPTION.test(previous.line.text)) {
        caption = previous.line.text;
        segments.pop();
      }
      const table = buildTable(run);
      if (table.rows.length === 0) {
        for (const row of run) segments.push({ type: "line", line: row });
      } else {
        segments.push({ type: "table", caption, ...table });
      }
    } else {
      for (const row of run) segments.push({ type: "line", line: row });
    }
    i = end;
  }
  return segments;
}
