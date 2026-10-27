import { promises as fs } from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/http/errors";
import { parseQuestions, type EvalQuestion } from "./dataset";

const EVAL_DIR = path.join(process.cwd(), "data", "eval");

export async function loadQuestionsFromDisk(): Promise<EvalQuestion[]> {
  for (const [file, format] of [
    ["questions.json", "json"],
    ["questions.csv", "csv"],
  ] as const) {
    try {
      const content = await fs.readFile(path.join(EVAL_DIR, file), "utf8");
      const questions = parseQuestions(content, format);
      if (questions.length === 0) throw AppError.validation(`${file} contains no usable questions`);
      return questions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof AppError) throw error;
      throw AppError.validation(`Could not parse data/eval/${file}`);
    }
  }
  throw AppError.notFound(
    "No evaluation questions found. Place questions.json or questions.csv in data/eval/ (see README) or upload a file.",
  );
}

export async function saveReportToDisk(runId: string, report: unknown): Promise<string> {
  const dir = path.join(EVAL_DIR, "results");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${runId}.json`);
  await fs.writeFile(target, JSON.stringify(report, null, 2));
  return target;
}
