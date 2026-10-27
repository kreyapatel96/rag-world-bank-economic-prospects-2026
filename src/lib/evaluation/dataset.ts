import { z } from "zod";

export interface EvalQuestion {
  id: string;
  question: string;
  expectedAnswer?: string;
  relevantPages?: number[];
}

const pickString = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
};

export function parsePageSpec(spec: unknown): number[] | undefined {
  if (Array.isArray(spec)) {
    const pages = spec.flatMap((item) => parsePageSpec(item) ?? []);
    return pages.length > 0 ? [...new Set(pages)].sort((a, b) => a - b) : undefined;
  }
  if (typeof spec === "number" && Number.isInteger(spec) && spec > 0) return [spec];
  if (typeof spec !== "string") return undefined;
  const pages = new Set<number>();
  for (const part of spec.split(/[;,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 200) for (let p = start; p <= end; p++) pages.add(p);
    } else if (/^\d+$/.test(part) && Number(part) > 0) {
      pages.add(Number(part));
    }
  }
  return pages.size > 0 ? [...pages].sort((a, b) => a - b) : undefined;
}

function toQuestion(row: Record<string, unknown>, index: number): EvalQuestion | null {
  const question = pickString(row, ["question", "prompt", "query"]);
  if (!question) return null;
  return {
    id: pickString(row, ["id", "qid"]) ?? `q${index + 1}`,
    question,
    expectedAnswer: pickString(row, [
      "expectedAnswer",
      "expected_answer",
      "answer",
      "reference_answer",
      "referenceAnswer",
    ]),
    relevantPages: parsePageSpec(
      row.relevantPages ?? row.relevant_pages ?? row.pages ?? row.source_pages ?? row.sourcePages,
    ),
  };
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((key, i) => [key, cells[i] ?? ""])));
}

const jsonShape = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ questions: z.array(z.record(z.string(), z.unknown())) }),
]);

export function parseQuestions(content: string, format: "json" | "csv"): EvalQuestion[] {
  const rows =
    format === "csv"
      ? parseCsv(content)
      : (() => {
          const parsed = jsonShape.parse(JSON.parse(content));
          return Array.isArray(parsed) ? parsed : parsed.questions;
        })();
  const questions = rows.map(toQuestion).filter((q): q is EvalQuestion => q !== null);
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id: ${q.id}`);
    ids.add(q.id);
  }
  return questions;
}
