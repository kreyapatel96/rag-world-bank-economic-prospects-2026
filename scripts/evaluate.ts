import { promises as fs } from "node:fs";
import { documentsCollection } from "@/lib/db/collections";
import { closeDb } from "@/lib/db/mongo";
import { parseQuestions } from "@/lib/evaluation/dataset";
import { loadQuestionsFromDisk, saveReportToDisk } from "@/lib/evaluation/files";
import { runEvaluation, saveEvaluation } from "@/lib/evaluation/runner";
import type { GenerationMode, ProviderId } from "@/lib/llm/types";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const mode = (arg("mode") ?? "gemini_fallback") as GenerationMode;
  const judge = (arg("judge") ?? "none") as ProviderId | "none";
  if (!["gemini_fallback", "ollama", "compare"].includes(mode)) throw new Error("Invalid --mode");
  if (!["gemini", "ollama", "none"].includes(judge)) throw new Error("Invalid --judge");

  const documents = await documentsCollection();
  const documentId =
    arg("document") ??
    (await documents.find({ status: "ready" }).sort({ createdAt: -1 }).limit(1).next())?._id;
  if (!documentId) throw new Error("No ready document found. Ingest a report first.");

  const questionsFile = arg("questions");
  let questions = questionsFile
    ? parseQuestions(
        await fs.readFile(questionsFile, "utf8"),
        questionsFile.endsWith(".csv") ? "csv" : "json",
      )
    : await loadQuestionsFromDisk();
  const limit = Number(arg("limit") ?? 0);
  if (limit > 0) questions = questions.slice(0, limit);

  const report = await runEvaluation({
    documentId,
    questions,
    mode,
    judge,
    onProgress: (done, total) => console.log(`Evaluated ${done}/${total}`),
  });
  await saveEvaluation(report);
  const file = await saveReportToDisk(report.runId, report);
  console.log(
    JSON.stringify({ retrieval: report.retrieval, providers: report.providers }, null, 2),
  );
  console.log(`Saved report to ${file}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
