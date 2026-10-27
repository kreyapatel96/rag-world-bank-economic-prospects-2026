import { definePDFJSModule, getDocumentProxy } from "unpdf";
import { AppError } from "@/lib/http/errors";
import { arrangeRows, type ItemRow } from "./layout";
import type { PageContent, PageLine, TextCell, TextItem } from "./types";

let pdfjsReady: Promise<void> | undefined;

// The legacy build runs on Node 18+; the default serverless build needs Node 22 globals.
function configurePdfjs(): Promise<void> {
  if (typeof Promise.withResolvers !== "function") {
    Promise.withResolvers = function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
  pdfjsReady ??= definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  return pdfjsReady;
}

const LIGATURES: Record<string, string> = { ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl" };

export function normalizeText(text: string): string {
  return text
    .replace(/[ﬀ-ﬄ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/­/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​﻿]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isTextItem(
  item: unknown,
): item is { str: string; transform: number[]; width: number; height: number } {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return typeof candidate.str === "string" && Array.isArray(candidate.transform);
}

function buildLine(row: TextItem[], column: ItemRow["column"]): PageLine | null {
  const fontSize = Math.max(...row.map((i) => i.fontSize));
  const cells: TextCell[] = [];
  for (const item of row) {
    const text = item.str;
    if (text.trim() === "") continue;
    const last = cells[cells.length - 1];
    const gap = last ? item.x - last.x1 : Infinity;
    if (last && gap < fontSize * 0.6) {
      const needsSpace = gap > fontSize * 0.12 && !last.text.endsWith(" ") && !text.startsWith(" ");
      last.text += (needsSpace ? " " : "") + text;
      last.x1 = item.x + item.width;
    } else {
      cells.push({ text, x0: item.x, x1: item.x + item.width });
    }
  }
  const normalized = cells
    .map((c) => ({ ...c, text: normalizeText(c.text) }))
    .filter((c) => c.text.length > 0);
  if (normalized.length === 0) return null;
  const first = normalized[0];
  if (!first) return null;
  return {
    text: normalized.map((c) => c.text).join(" "),
    column,
    y: row[0]?.y ?? 0,
    x0: first.x0,
    fontSize,
    cells: normalized,
  };
}

export async function extractPages(data: Uint8Array): Promise<PageContent[]> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    await configurePdfjs();
    pdf = await getDocumentProxy(data, { useSystemFonts: true });
  } catch (error) {
    console.error("PDF open failed:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.name === "InvalidPDFException") {
      throw AppError.validation("The file could not be parsed as a PDF");
    }
    throw new AppError("internal_error", "The PDF engine failed to start; see server logs", 500);
  }
  const pages: PageContent[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        const [a = 0, b = 0, , , e = 0, f = 0] = item.transform;
        items.push({
          str: item.str,
          x: e,
          y: f,
          width: item.width,
          fontSize: Math.hypot(a, b) || item.height,
        });
      }
      const layout = arrangeRows(items, viewport.width);
      const lines = layout.rows
        .map((row) => buildLine(row.items, row.column))
        .filter((line): line is PageLine => line !== null);
      pages.push({
        pageNumber,
        height: viewport.height,
        twoColumn: layout.twoColumn,
        lines,
      });
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }
  return pages;
}
