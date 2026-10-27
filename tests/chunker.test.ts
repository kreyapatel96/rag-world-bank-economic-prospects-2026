import { describe, expect, it } from "vitest";
import { buildHierarchy, pageAt, tableToChunkTexts } from "@/lib/ingestion/chunker";
import type { Block } from "@/lib/ingestion/types";

const options = {
  strategy: "hierarchical" as const,
  windowSentences: 5,
  targetTokens: 60,
  maxTokens: 90,
  overlapTokens: 15,
};

const sentence = (n: number) =>
  `Sentence ${n} explains the growth outlook for developing economies.`;
const text = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => sentence(from + i)).join(" ");

function paragraph(body: string, pageStart: number, pageEnd = pageStart, breakOffset = 0): Block {
  const breaks = [{ offset: 0, page: pageStart }];
  if (pageEnd !== pageStart) breaks.push({ offset: breakOffset, page: pageEnd });
  return { type: "paragraph", text: body, breaks, pageStart, pageEnd };
}

describe("hierarchical chunking", () => {
  it("never merges text across section boundaries and keeps parent titles", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "Chapter 1", page: 1 },
      { type: "heading", level: 2, text: "Outlook", page: 1 },
      paragraph(text(1, 3), 1),
      { type: "heading", level: 3, text: "Regional detail", page: 2 },
      paragraph(text(4, 6), 2),
      { type: "heading", level: 2, text: "Risks", page: 3 },
      paragraph(text(7, 9), 3),
    ];
    const { sections, chunks } = buildHierarchy("d", blocks, options, "Doc");
    expect(sections.map((s) => [s.level, s.title])).toEqual([
      [1, "Chapter 1"],
      [2, "Outlook"],
      [3, "Regional detail"],
      [2, "Risks"],
    ]);
    expect(sections[2]?.parentId).toBe(sections[1]?._id);
    expect(sections[3]?.parentId).toBe(sections[0]?._id);

    const detail = chunks.find((c) => c.text.includes("Sentence 5"));
    expect(detail).toMatchObject({
      chapterTitle: "Chapter 1",
      sectionTitle: "Outlook",
      subsectionTitle: "Regional detail",
    });
    const risks = chunks.find((c) => c.text.includes("Sentence 8"));
    expect(risks).toMatchObject({ sectionTitle: "Risks", subsectionTitle: "" });
    expect(chunks.some((c) => c.text.includes("Sentence 3") && c.text.includes("Sentence 8"))).toBe(
      false,
    );
  });

  it("splits long sections into overlapping chunks within the token limit", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "Chapter 1", page: 1 },
      paragraph(text(1, 30), 1),
    ];
    const { chunks } = buildHierarchy("d", blocks, { ...options, overlapTokens: 40 }, "Doc");
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(options.maxTokens);
    const [a, b] = chunks;
    const lastSentenceOfFirst =
      a?.text
        .trim()
        .split(/(?<=\.) /)
        .pop() ?? "";
    expect(b?.text.includes(lastSentenceOfFirst)).toBe(true);
    const joined = chunks.map((c) => c.text).join(" ");
    for (let n = 1; n <= 30; n++) expect(joined).toContain(`Sentence ${n} `);
  });

  it("assigns page ranges that follow the page boundary inside a paragraph", () => {
    const body = text(1, 10);
    const breakOffset = body.indexOf("Sentence 6");
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "Chapter 1", page: 4 },
      paragraph(body, 4, 5, breakOffset),
    ];
    const { chunks } = buildHierarchy(
      "d",
      blocks,
      { ...options, targetTokens: 40, maxTokens: 80, overlapTokens: 0 },
      "Doc",
    );
    const first = chunks[0];
    const last = chunks[chunks.length - 1];
    expect(first?.pageStart).toBe(4);
    expect(first?.pageEnd).toBe(4);
    expect(last?.pageEnd).toBe(5);
    expect(
      pageAt(
        [
          { offset: 0, page: 4 },
          { offset: 100, page: 5 },
        ],
        99,
      ),
    ).toBe(4);
  });

  it("uses the document title when content precedes any heading", () => {
    const { chunks, sections } = buildHierarchy(
      "d",
      [paragraph(text(1, 2), 1)],
      options,
      "Report Title",
    );
    expect(sections[0]?.title).toBe("Report Title");
    expect(chunks[0]?.chapterTitle).toBe("Report Title");
  });

  it("keeps table headers with every row group and records the table metadata", () => {
    const table: Extract<Block, { type: "table" }> = {
      type: "table",
      caption: "Table 2 Growth",
      headers: ["Country", "2023", "2024"],
      rows: Array.from({ length: 40 }, (_, i) => [`Country ${i}`, `${i}.1`, `${i}.2`]),
      page: 7,
    };
    const parts = tableToChunkTexts(table, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.text).toContain("Columns: Country | 2023 | 2024");
    expect(parts.reduce((n, p) => n + p.rowCount, 0)).toBe(40);
    expect(parts[0]?.text).toContain("- Country 0 | 2023: 0.1 | 2024: 0.2");

    const { chunks } = buildHierarchy(
      "d",
      [{ type: "heading", level: 1, text: "C", page: 7 }, table],
      options,
      "Doc",
    );
    expect(chunks.every((c) => c.kind === "table" && c.pageStart === 7)).toBe(true);
    expect(chunks[0]?.table?.headers).toEqual(["Country", "2023", "2024"]);
  });

  it("does not split on common abbreviations", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "C", page: 1 },
      paragraph("The U.S. economy grew, e.g. in services. Growth was 2.5 percent in 2024.", 1),
    ];
    const { chunks } = buildHierarchy("d", blocks, options, "Doc");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("The U.S. economy");
  });
});
