"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, postJson } from "@/lib/client/api";
import type { DocumentDto } from "@/lib/documents/service";

interface Props {
  documents: DocumentDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
}

const STATUS_STYLES: Record<DocumentDto["status"], string> = {
  queued: "bg-slate-200 text-slate-800",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function formatBytes(bytes: number) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function DocumentsPanel({ documents, selectedId, onSelect, onChanged }: Props) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const busy = documents.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void onChanged(), 2000);
    return () => clearInterval(timer);
  }, [busy, onChanged]);

  const upload = useCallback(
    async (file: File) => {
      if (documents.length > 0) {
        const names = documents.map((d) => `"${d.filename}"`).join(", ");
        const confirmed = window.confirm(
          `Uploading a report replaces the current one. ${names} and all of its pages, chunks and evaluation runs will be deleted. Continue?`,
        );
        if (!confirmed) {
          if (input.current) input.current.value = "";
          return;
        }
      }
      setUploading(true);
      setMessage(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const result = await api<{ document: DocumentDto }>("/api/documents", {
          method: "POST",
          body: form,
        });
        await onChanged();
        onSelect(result.document.id);
        setMessage({ kind: "info", text: "Upload accepted. Processing has started." });
      } catch (error) {
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Upload failed",
        });
      } finally {
        setUploading(false);
        if (input.current) input.current.value = "";
      }
    },
    [documents, onChanged, onSelect],
  );

  const act = async (label: string, run: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await run();
      await onChanged();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : `${label} failed`,
      });
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-dashed border-slate-400 p-6 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Upload the World Bank report (PDF). A new upload replaces the current report and deletes
          its data.
        </p>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="mt-3 text-sm"
        />
        {uploading && <p className="mt-2 text-sm">Uploading...</p>}
      </div>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${message.kind === "error" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"}`}
        >
          {message.text}
        </p>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">No documents yet. Upload a PDF to begin.</p>
      ) : (
        <ul className="space-y-3">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className={`rounded-lg border p-4 ${selectedId === doc.id ? "border-blue-500" : "border-slate-300 dark:border-slate-700"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{doc.filename}</p>
                  <p className="text-xs text-slate-500">
                    Uploaded {new Date(doc.createdAt).toLocaleString()} ·{" "}
                    {formatBytes(doc.fileSize)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[doc.status]}`}
                >
                  {doc.status}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <div>
                  <dt className="text-xs text-slate-500">Pages</dt>
                  <dd>{doc.pageCount || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Chunks</dt>
                  <dd>{doc.chunkCount || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Sections</dt>
                  <dd>{doc.sectionCount || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Chunking</dt>
                  <dd className="truncate">{doc.chunkingStrategy ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Embedding</dt>
                  <dd className="truncate">{doc.embeddingModel ?? "-"}</dd>
                </div>
              </dl>

              {(doc.status === "processing" || doc.status === "queued") && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded bg-slate-200">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{ width: `${doc.progress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{doc.stage}</p>
                </div>
              )}
              {doc.techniques.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer">How this report was processed</summary>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                    {doc.techniques.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </details>
              )}
              {doc.error && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {doc.error}
                </p>
              )}
              {doc.warnings.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-amber-700">
                    {doc.warnings.length} processing note(s)
                  </summary>
                  <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                    {doc.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <button
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={doc.status !== "ready"}
                  onClick={() => onSelect(doc.id)}
                >
                  {selectedId === doc.id ? "Selected" : "Use for questions"}
                </button>
                <button
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={doc.status === "processing" || doc.status === "queued"}
                  onClick={() =>
                    void act("Reprocess", () => postJson(`/api/documents/${doc.id}/reprocess`, {}))
                  }
                >
                  Reprocess
                </button>
                <button
                  className="rounded border border-red-300 px-3 py-1 text-red-700 disabled:opacity-50"
                  onClick={() => {
                    const running = doc.status === "processing" || doc.status === "queued";
                    const message = running
                      ? `Stop processing and delete "${doc.filename}" with everything stored for it?`
                      : `Delete "${doc.filename}" and all of its stored chunks?`;
                    if (window.confirm(message)) {
                      void act("Delete", () =>
                        api(`/api/documents/${doc.id}`, { method: "DELETE" }),
                      );
                    }
                  }}
                >
                  {doc.status === "processing" || doc.status === "queued"
                    ? "Stop and delete"
                    : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
