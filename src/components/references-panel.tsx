"use client";

import { useEffect, useRef, useState } from "react";
import type { PassageDto, RagResponse } from "@/lib/rag/types";
import { RetrievalInspector } from "./retrieval-inspector";

const PROVIDER_LABEL = { gemini: "Gemini", ollama: "Ollama" } as const;

interface Props {
  response: RagResponse | null;
  question: string | null;
  activeSourceId: string | null;
  onActivate: (sourceId: string) => void;
}

interface CitedSource {
  passage: PassageDto;
  citedBy: ("gemini" | "ollama")[];
}

const trail = (p: PassageDto) =>
  [p.chapterTitle, p.sectionTitle, p.subsectionTitle].filter(Boolean).join(" › ");

const pages = (p: PassageDto) =>
  p.pageStart === p.pageEnd ? `Page ${p.pageStart}` : `Pages ${p.pageStart}–${p.pageEnd}`;

function citedSources(response: RagResponse): CitedSource[] {
  const byId = new Map<string, CitedSource>();
  for (const answer of response.answers) {
    for (const citation of answer.citations) {
      const passage = response.context.passages.find((p) => p.sourceId === citation.sourceId);
      if (!passage) continue;
      const entry = byId.get(passage.sourceId) ?? { passage, citedBy: [] };
      if (!entry.citedBy.includes(answer.provider)) entry.citedBy.push(answer.provider);
      byId.set(passage.sourceId, entry);
    }
  }
  return [...byId.values()].sort(
    (a, b) => Number(a.passage.sourceId.slice(1)) - Number(b.passage.sourceId.slice(1)),
  );
}

function SourceCard({
  source,
  active,
  showProviders,
  onActivate,
}: {
  source: CitedSource;
  active: boolean;
  showProviders: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [expanded, setExpanded] = useState(false);
  const open = expanded || active;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  const { passage } = source;
  return (
    <li
      ref={ref}
      className={`rounded-lg border p-3 text-sm transition-colors ${
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
          : "border-slate-300 dark:border-slate-700"
      }`}
    >
      <button type="button" onClick={onActivate} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
            {passage.sourceId}
          </span>
          <span className="font-medium">{pages(passage)}</span>
          {showProviders &&
            source.citedBy.map((p) => (
              <span key={p} className="rounded bg-slate-200 px-1.5 text-xs text-slate-700">
                {PROVIDER_LABEL[p]}
              </span>
            ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{trail(passage)}</p>
      </button>
      <p
        className={`mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300 ${
          open ? "" : "line-clamp-4"
        }`}
      >
        {passage.text}
      </p>
      {!active && passage.text.length > 280 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-700 underline"
        >
          {expanded ? "Show less" : "Show full passage"}
        </button>
      )}
    </li>
  );
}

export function ReferencesPanel({ response, question, activeSourceId, onActivate }: Props) {
  if (!response) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700">
        <h2 className="mb-1 font-semibold text-slate-700 dark:text-slate-200">References</h2>
        Ask a question. The report passages behind each answer appear here, with page numbers.
      </div>
    );
  }

  const sources = citedSources(response);
  const showProviders = response.answers.length > 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">References</h2>
        {question && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">For: {question}</p>}
      </div>

      {sources.length > 0 ? (
        <ul className="space-y-2">
          {sources.map((source) => (
            <SourceCard
              key={source.passage.sourceId}
              source={source}
              active={activeSourceId === source.passage.sourceId}
              showProviders={showProviders}
              onActivate={() => onActivate(source.passage.sourceId)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {response.status === "no_context"
            ? "No passages were found in the report for this question."
            : "The answer cites no passages. All retrieved passages are listed below."}
        </p>
      )}

      <RetrievalInspector response={response} />
    </div>
  );
}
