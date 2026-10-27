"use client";

import { useState } from "react";
import { decimal } from "@/lib/client/api";
import type { RagResponse, RetrievedChunkDto } from "@/lib/rag/types";

const pages = (start: number, end: number) =>
  start === end ? `p. ${start}` : `pp. ${start}-${end}`;
const trail = (c: { chapterTitle: string; sectionTitle: string; subsectionTitle: string }) =>
  [c.chapterTitle, c.sectionTitle, c.subsectionTitle].filter(Boolean).join(" > ");

function ChunkRow({ chunk, rank }: { chunk: RetrievedChunkDto; rank: number }) {
  const [full, setFull] = useState(false);
  const excerpt = full || chunk.text.length <= 320 ? chunk.text : `${chunk.text.slice(0, 320)}...`;
  return (
    <li className="rounded border border-slate-300 p-3 text-sm dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">#{rank}</span>
        <span className="text-slate-600 dark:text-slate-300">{trail(chunk)}</span>
        <span className="text-xs text-slate-500">{pages(chunk.pageStart, chunk.pageEnd)}</span>
        <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-800">{chunk.method}</span>
        {chunk.kind === "table" && (
          <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">table</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {chunk.chunkId} · fused {decimal(chunk.fusedScore, 4)}
        {chunk.semantic && ` · semantic #${chunk.semantic.rank} (${decimal(chunk.semantic.score)})`}
        {chunk.keyword && ` · keyword #${chunk.keyword.rank} (${decimal(chunk.keyword.score, 2)})`}
      </p>
      <p className="mt-2 whitespace-pre-wrap">{excerpt}</p>
      {chunk.text.length > 320 && (
        <button className="mt-1 text-xs text-blue-700 underline" onClick={() => setFull((v) => !v)}>
          {full ? "Show less" : "Show full text"}
        </button>
      )}
    </li>
  );
}

export function RetrievalInspector({ response }: { response: RagResponse }) {
  const { retrieval, context } = response;
  return (
    <details className="rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-medium">
        All retrieved passages ({retrieval.chunks.length}) · context {context.totalTokens}/
        {context.budgetTokens} tokens
      </summary>
      <div className="mt-3 space-y-4">
        {!retrieval.semantic.used && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Semantic search was not used; results are keyword-only. {retrieval.semantic.reason}
          </p>
        )}
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Retrieved chunks ({retrieval.latencyMs} ms)
          </h4>
          <ol className="space-y-2">
            {retrieval.chunks.map((chunk, index) => (
              <ChunkRow key={chunk.chunkId} chunk={chunk} rank={index + 1} />
            ))}
          </ol>
        </div>
        {context.passages.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Context sent to the model</h4>
            <ul className="space-y-2">
              {context.passages.map((p) => (
                <li
                  key={p.sourceId}
                  id={`${response.question}-${p.sourceId}`}
                  className="rounded border border-slate-300 p-3 text-sm dark:border-slate-700"
                >
                  <p className="font-medium">
                    [{p.sourceId}] {pages(p.pageStart, p.pageEnd)} · {trail(p)}
                    {p.expanded && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        expanded to full section
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    {p.text}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
