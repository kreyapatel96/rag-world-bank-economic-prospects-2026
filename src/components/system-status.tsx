"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

interface Health {
  mongo: { connected: boolean };
  vectorIndex: { state: string; message: string };
  gemini: { apiKeyConfigured: boolean; model: string | null };
  ollama: {
    reachable: boolean;
    message?: string;
    chatModel?: { name: string | null; installed: boolean };
    embeddingModel?: { ok: boolean; message: string };
  };
}

export function SystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Health>("/api/health").then(setHealth, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Status check failed"),
    );
  }, []);

  const items: { label: string; ok: boolean; detail: string }[] = health
    ? [
        { label: "MongoDB", ok: health.mongo.connected, detail: "Connected" },
        {
          label: "Vector index",
          ok: health.vectorIndex.state === "ready",
          detail: health.vectorIndex.message,
        },
        {
          label: "Gemini",
          ok: health.gemini.apiKeyConfigured && Boolean(health.gemini.model),
          detail:
            health.gemini.apiKeyConfigured && health.gemini.model
              ? health.gemini.model
              : "GEMINI_API_KEY or GEMINI_MODEL is not set",
        },
        {
          label: "Ollama",
          ok: health.ollama.reachable && Boolean(health.ollama.chatModel?.installed),
          detail: !health.ollama.reachable
            ? (health.ollama.message ?? "Not reachable")
            : health.ollama.chatModel?.installed
              ? `${health.ollama.chatModel.name} ready`
              : "Chat model not installed or OLLAMA_CHAT_MODEL not set",
        },
        {
          label: "Embeddings",
          ok: Boolean(health.ollama.embeddingModel?.ok),
          detail: health.ollama.embeddingModel?.message ?? "Unavailable",
        },
      ]
    : [];

  return (
    <details className="relative text-sm">
      <summary className="cursor-pointer rounded border px-3 py-1">System status</summary>
      <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border bg-white p-3 text-slate-900 shadow-lg">
        {error && <p className="text-red-700">{error}</p>}
        {!health && !error && <p className="text-slate-500">Checking...</p>}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label}>
              <span className={item.ok ? "text-emerald-700" : "text-amber-700"}>
                {item.ok ? "OK" : "Needs attention"}
              </span>{" "}
              <span className="font-medium">{item.label}</span>
              <p className="text-xs text-slate-600">{item.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
