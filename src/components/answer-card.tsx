"use client";

import { milliseconds } from "@/lib/client/api";
import type { AnswerDto } from "@/lib/rag/types";
import { MarkdownAnswer } from "./markdown-answer";

const PROVIDER_LABEL = { gemini: "Gemini", ollama: "Ollama" } as const;

interface Props {
  answer: AnswerDto;
  onCitationClick: (sourceId: string) => void;
}

export function AnswerCard({ answer, onCitationClick }: Props) {
  const title = `${PROVIDER_LABEL[answer.provider]}${answer.model ? ` · ${answer.model}` : ""}`;

  return (
    <article className="rounded-xl border border-slate-300 bg-white/60 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
        <span>
          {answer.usedAsFallback && (
            <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">fallback</span>
          )}
          {milliseconds(answer.latencyMs)}
        </span>
      </header>

      {answer.status === "failed" ? (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {PROVIDER_LABEL[answer.provider]} failed ({answer.failure?.category ?? "unknown"}):{" "}
          {answer.failure?.message}
        </p>
      ) : (
        <>
          <MarkdownAnswer text={answer.text ?? ""} onCitationClick={onCitationClick} />
          {answer.insufficientEvidence && (
            <p className="mt-2 text-xs text-slate-500">
              The retrieved passages did not contain enough evidence.
            </p>
          )}
          {answer.uncited && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              This answer has no valid source citations. Check it against the references.
            </p>
          )}
          {answer.invalidCitationMarkers.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Removed unsupported citation markers: {answer.invalidCitationMarkers.join(", ")}
            </p>
          )}
        </>
      )}
    </article>
  );
}
