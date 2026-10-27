import { beforeAll, describe, expect, it } from "vitest";
import { buildHierarchy } from "@/lib/ingestion/chunker";
import { removeRunningHeadersAndFooters } from "@/lib/ingestion/clean-pages";
import { extractPages } from "@/lib/ingestion/extract-pdf";
import { buildBlocks } from "@/lib/ingestion/structure";
import type { Block, PageContent } from "@/lib/ingestion/types";
import { buildSamplePdf } from "./helpers/make-pdf";

describe("PDF ingestion on a generated report", () => {
  let pages: PageContent[];
  let blocks: Block[];

  beforeAll(async () => {
    const raw = await extractPages(await buildSamplePdf());
    pages = removeRunningHeadersAndFooters(raw).pages;
    blocks = buildBlocks(pages).blocks;
  });

  it("extracts every page with its number", () => {
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
  });

  it("removes repeated headers and page numbers but keeps body text", () => {
    const text = pages.flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    expect(text).not.toContain("Global Economic Prospects");
    expect(text).toContain("Oil prices are expected");
  });

  it("detects chapter, section headings and their levels", () => {
    const headings = blocks.filter(
      (b): b is Extract<Block, { type: "heading" }> => b.type === "heading",
    );
    const byText = Object.fromEntries(headings.map((h) => [h.text, h.level]));
    expect(byText["Chapter 1 Growth Outlook"]).toBe(1);
    expect(byText["Regional Growth"]).toBe(2);
    expect(byText["Chapter 2 Risks"]).toBe(1);
    expect(byText["Downside Risks"]).toBe(2);
  });

  it("extracts the table with headers and row values", () => {
    const table = blocks.find((b): b is Extract<Block, { type: "table" }> => b.type === "table");
    expect(table).toBeDefined();
    expect(table?.caption).toContain("Table 1.1");
    expect(table?.headers).toEqual(["Region", "2023", "2024", "2025"]);
    expect(table?.rows).toContainEqual(["South Asia", "6.2", "6.0", "5.8"]);
  });

  it("builds a hierarchy whose chunks keep parent titles and page ranges", () => {
    const { sections, chunks } = buildHierarchy(
      "doc",
      blocks,
      {
        strategy: "hierarchical",
        windowSentences: 5,
        targetTokens: 120,
        maxTokens: 200,
        overlapTokens: 20,
      },
      "Sample",
    );
    expect(sections.some((s) => s.level === 1 && s.title === "Chapter 1 Growth Outlook")).toBe(
      true,
    );
    const oil = chunks.find((c) => c.text.includes("Oil prices"));
    expect(oil?.chapterTitle).toBe("Chapter 1 Growth Outlook");
    expect(oil?.sectionTitle).toBe("Commodity Prices");
    const tableChunk = chunks.find((c) => c.kind === "table");
    expect(tableChunk?.pageStart).toBe(2);
    expect(tableChunk?.text).toContain("South Asia | 2023: 6.2 | 2024: 6.0 | 2025: 5.8");
    const risk = chunks.find((c) => c.text.includes("Geopolitical"));
    expect(risk?.chapterTitle).toBe("Chapter 2 Risks");
    expect(risk?.pageStart).toBe(3);
    expect(chunks.every((c, i) => c.order === i && c._id === `doc-c${i}`)).toBe(true);
  });
});
