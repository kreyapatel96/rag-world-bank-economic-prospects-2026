"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentDto } from "@/lib/documents/service";
import { postJson } from "@/lib/client/api";
import type { RagResponse } from "@/lib/rag/types";
import { AnswerCard } from "./answer-card";
import { ReferencesPanel } from "./references-panel";

type Mode = "gemini_fallback" | "ollama" | "compare";

const MODES: { value: Mode; label: string }[] = [
  { value: "gemini_fallback", label: "Gemini with Ollama fallback" },
  { value: "ollama", label: "Ollama only" },
  { value: "compare", label: "Compare Gemini and Ollama" },
];

interface Message {
  id: number;
  question: string;
  state: "loading" | "done" | "error";
  response?: RagResponse;
  error?: string;
}

export function ChatPanel({ document }: { document: DocumentDto | null }) {
  const [mode, setMode] = useState<Mode>("gemini_fallback");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);

  const ready = document?.status === "ready";
  const sending = messages.some((m) => m.state === "loading");
  const selected = messages.find((m) => m.id === selectedId);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const patch = (id: number, update: Partial<Message>) =>
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...update } : m)));

  const showReference = (messageId: number, sourceId: string | null) => {
    setSelectedId(messageId);
    setActiveSource(sourceId);
  };

  const submit = async () => {
    const text = question.trim();
    if (!document || !ready || text.length < 3 || sending) return;
    const id = nextId.current++;
    setMessages((current) => [...current, { id, question: text, state: "loading" }]);
    setSelectedId(id);
    setActiveSource(null);
    setQuestion("");
    try {
      const response = await postJson<RagResponse>(
        mode === "compare" ? "/api/compare" : "/api/ask",
        {
          documentId: document.id,
          question: text,
          ...(mode === "compare" ? {} : { mode }),
        },
      );
      patch(id, { state: "done", response });
    } catch (error) {
      patch(id, {
        state: "error",
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-h-[60vh] flex-col">
        <p className="mb-3 text-sm text-slate-500">
          {!document
            ? "Select a processed document in the Documents tab to start asking questions."
            : !ready
              ? `"${document.filename}" is ${document.status}. Questions are available once it is ready.`
              : `Asking about: ${document.filename}`}
        </p>

        {messages.length === 0 && ready && (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            Ask a question about the report. Answers cite page numbers; the references open on the
            right.
          </p>
        )}

        <div className="flex-1 space-y-6">
          {messages.map((m) => (
            <div key={m.id} className="space-y-3">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-700 px-4 py-2 text-sm text-white">
                  {m.question}
                </p>
              </div>

              {m.state === "loading" && (
                <p role="status" className="text-sm text-slate-500">
                  Retrieving passages and generating an answer...
                </p>
              )}
              {m.state === "error" && (
                <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                  {m.error}
                </p>
              )}

              {m.response && (
                <div
                  className={`space-y-3 rounded-2xl ${selectedId === m.id ? "" : "opacity-90"}`}
                  onClick={() => selectedId !== m.id && showReference(m.id, null)}
                >
                  {m.response.status === "no_context" && (
                    <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No relevant passages were found in the report for this question.
                    </p>
                  )}
                  {m.response.status === "failed" && (
                    <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                      No model could answer. The retrieved passages are in the references.
                    </p>
                  )}
                  <div className={m.response.answers.length > 1 ? "grid gap-3 xl:grid-cols-2" : ""}>
                    {m.response.answers.map((answer) => (
                      <AnswerCard
                        key={answer.provider}
                        answer={answer}
                        onCitationClick={(sourceId) => showReference(m.id, sourceId)}
                      />
                    ))}
                  </div>
                  {selectedId !== m.id && (
                    <button
                      type="button"
                      className="text-xs text-blue-700 underline"
                      onClick={() => showReference(m.id, null)}
                    >
                      Show references
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <form
          className="sticky bottom-0 mt-4 space-y-2 border-t border-slate-300 bg-[var(--background)] py-3 dark:border-slate-700"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="mode" className="text-sm text-slate-600 dark:text-slate-300">
              Model
            </label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded border bg-transparent px-2 py-1 text-sm"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value} className="text-black">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <textarea
              value={question}
              maxLength={2000}
              rows={2}
              disabled={!ready}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Ask about the report..."
              aria-label="Question"
              className="min-w-0 flex-1 resize-none rounded-xl border bg-transparent px-3 py-2 text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!ready || sending || question.trim().length < 3}
              className="rounded-xl bg-blue-700 px-5 text-sm font-medium text-white disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </form>
      </div>

      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <ReferencesPanel
          response={selected?.response ?? null}
          question={selected?.question ?? null}
          activeSourceId={activeSource}
          onActivate={(sourceId) => setActiveSource(sourceId)}
        />
      </aside>
    </section>
  );
}
