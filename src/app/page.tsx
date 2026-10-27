"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { EvaluationPanel } from "@/components/evaluation-panel";
import { SystemStatus } from "@/components/system-status";
import { api } from "@/lib/client/api";
import type { DocumentDto } from "@/lib/documents/service";

const TABS = [
  { id: "documents", label: "Documents" },
  { id: "chat", label: "Chat" },
  { id: "evaluation", label: "Evaluation" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<TabId>("documents");
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((list: DocumentDto[]) => {
    setDocuments(list);
    setLoadError(null);
    setSelectedId((current) => {
      if (current && list.some((d) => d.id === current)) return current;
      return list.find((d) => d.status === "ready")?.id ?? list[0]?.id ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply((await api<{ documents: DocumentDto[] }>("/api/documents")).documents);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load documents");
    }
  }, [apply]);

  useEffect(() => {
    api<{ documents: DocumentDto[] }>("/api/documents").then(
      (result) => apply(result.documents),
      (error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Could not load documents"),
    );
  }, [apply]);

  const selected = documents.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div>
          <h1 className="text-xl font-semibold">World Bank Report Q&amp;A</h1>
          <p className="text-sm text-slate-500">Grounded answers with page citations</p>
        </div>
        <SystemStatus />
      </header>

      <nav
        className="mb-5 flex gap-1 border-b border-slate-300 dark:border-slate-700"
        aria-label="Sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loadError && (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </p>
      )}

      {tab === "documents" && (
        <DocumentsPanel
          documents={documents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChanged={refresh}
        />
      )}
      {tab === "chat" && <ChatPanel document={selected} />}
      {tab === "evaluation" && (
        <div className="max-w-5xl">
          <EvaluationPanel document={selected} />
        </div>
      )}
    </div>
  );
}
