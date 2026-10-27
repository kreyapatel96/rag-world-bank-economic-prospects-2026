"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentDto } from "@/lib/documents/service";
import { api, decimal, milliseconds, percent, postJson } from "@/lib/client/api";
import type { EvalReport } from "@/lib/evaluation/types";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

async function fetchRuns(documentId: string): Promise<EvalReport[]> {
  return (await api<{ runs: EvalReport[] }>(`/api/evaluate?documentId=${documentId}`)).runs;
}

export function EvaluationPanel({ document }: { document: DocumentDto | null }) {
  const [runs, setRuns] = useState<EvalReport[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"gemini_fallback" | "ollama" | "compare">("gemini_fallback");
  const [judge, setJudge] = useState<"none" | "gemini" | "ollama">("none");
  const [limit, setLimit] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documentId = document?.id;
  const applyRuns = useCallback((list: EvalReport[]) => {
    setRuns(list);
    setSelected(0);
  }, []);

  useEffect(() => {
    if (!documentId) return;
    fetchRuns(documentId).then(applyRuns, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not load evaluation runs"),
    );
  }, [documentId, applyRuns]);

  const run = async () => {
    if (!document) return;
    setRunning(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { documentId: document.id, mode, judge };
      if (limit) body.limit = Number(limit);
      if (file) {
        body.questionsText = await file.text();
        body.questionsFormat = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
      }
      await postJson("/api/evaluate", body);
      applyRuns(await fetchRuns(document.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setRunning(false);
    }
  };

  const report = documentId ? runs[selected] : undefined;

  return (
    <section className="space-y-5">
      {!document || document.status !== "ready" ? (
        <p className="text-sm text-slate-500">
          Select a processed document to run or review evaluations.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Runs the sample questions from <code>data/eval/questions.json|csv</code> or an uploaded
            file against {document.filename}.
          </p>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              Answer mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="rounded border bg-transparent px-2 py-1"
              >
                <option className="text-black" value="gemini_fallback">
                  Gemini with Ollama fallback
                </option>
                <option className="text-black" value="ollama">
                  Ollama only
                </option>
                <option className="text-black" value="compare">
                  Compare both
                </option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              LLM judge
              <select
                value={judge}
                onChange={(e) => setJudge(e.target.value as typeof judge)}
                className="rounded border bg-transparent px-2 py-1"
              >
                <option className="text-black" value="none">
                  None
                </option>
                <option className="text-black" value="gemini">
                  Gemini
                </option>
                <option className="text-black" value="ollama">
                  Ollama
                </option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Max questions
              <input
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
                placeholder="all"
                className="w-20 rounded border bg-transparent px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              Questions file (optional)
              <input
                type="file"
                accept=".json,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              onClick={() => void run()}
              disabled={running}
              className="rounded bg-blue-700 px-4 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {running ? "Running..." : "Run evaluation"}
            </button>
          </div>
          {running && (
            <p role="status" className="text-sm text-slate-500">
              Evaluation in progress. This can take several minutes.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {!report ? (
        <p className="text-sm text-slate-500">
          No evaluation runs yet. Results appear here only after a real run completes.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>
              Run
              <select
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="ml-2 rounded border bg-transparent px-2 py-1"
              >
                {runs.map((r, i) => (
                  <option className="text-black" key={r.runId} value={i}>
                    {new Date(r.createdAt).toLocaleString()} · {r.mode}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-slate-500">
              K = {report.k} · judge: {report.judge}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric
              label="Questions tested"
              value={String(report.questionCount)}
              hint={`${report.labelledCount} with relevant-page labels`}
            />
            <Metric
              label="Retrieval hit rate"
              value={percent(report.retrieval.hitRate)}
              hint="labelled questions"
            />
            <Metric label={`Recall@${report.k}`} value={percent(report.retrieval.meanRecall)} />
            <Metric
              label={`Precision@${report.k}`}
              value={percent(report.retrieval.meanPrecision)}
            />
            <Metric label="MRR" value={decimal(report.retrieval.meanReciprocalRank)} />
            <Metric
              label="Context found"
              value={percent(report.retrieval.nonEmptyRate)}
              hint="questions with any retrieval"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2">Provider</th>
                  <th>Answered</th>
                  <th>Failure rate</th>
                  <th>Mean latency</th>
                  <th>Citation accuracy</th>
                  <th>Correctness</th>
                  <th>Unsupported claims</th>
                </tr>
              </thead>
              <tbody>
                {report.providers.map((p) => (
                  <tr key={p.provider} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="py-2 font-medium">{p.provider}</td>
                    <td>
                      {p.succeeded}/{p.attempted}
                    </td>
                    <td>
                      {percent(p.failureRate)}
                      {Object.keys(p.failuresByCategory).length > 0 && (
                        <span className="block text-xs text-slate-500">
                          {Object.entries(p.failuresByCategory)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(", ")}
                        </span>
                      )}
                    </td>
                    <td>{milliseconds(p.meanLatencyMs)}</td>
                    <td>
                      {percent(p.meanCitationAccuracy)}
                      <span className="block text-xs text-slate-500">
                        cited: {percent(p.citedAnswerRate)}
                      </span>
                    </td>
                    <td>
                      {p.correctness.judged > 0
                        ? `${decimal(p.correctness.meanScore, 2)} (${p.correctness.judged} judged)`
                        : "n/a"}
                    </td>
                    <td>
                      {p.unsupportedClaims.claims > 0
                        ? `${percent(p.unsupportedClaims.rate)} of ${p.unsupportedClaims.claims}`
                        : "n/a"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Per-question results</summary>
            <ul className="mt-2 space-y-2">
              {report.questions.map((q) => (
                <li
                  key={q.id}
                  className="rounded border border-slate-300 p-3 dark:border-slate-700"
                >
                  <p className="font-medium">
                    {q.id}: {q.question}
                  </p>
                  <p className="text-xs text-slate-500">
                    Retrieved pages: {q.retrievedPages.join(", ") || "none"}
                    {q.relevantPages && ` · expected pages: ${q.relevantPages.join(", ")}`}
                    {q.retrieval && ` · hit: ${q.retrieval.hit ? "yes" : "no"}`}
                  </p>
                  {q.error && <p className="text-xs text-red-700">{q.error}</p>}
                  {q.answers.map((a) => (
                    <p key={a.provider} className="mt-1 text-xs">
                      {a.provider}:{" "}
                      {a.status === "failed"
                        ? `failed (${a.failureCategory})`
                        : (a.answer ?? "").slice(0, 240)}
                      {a.verdict && ` · ${a.verdict}`}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </details>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Method notes and settings</summary>
            <ul className="mt-1 list-disc pl-5">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <pre className="mt-2 overflow-x-auto">{JSON.stringify(report.settings, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
