import { describe, expect, it } from "vitest";
import { buildHierarchy, countIncompleteChunks } from "@/lib/ingestion/chunker";
import { extractPages } from "@/lib/ingestion/extract-pdf";
import {
  boundarySimilarities,
  CHUNKING_STRATEGIES,
  packSentenceWindows,
  type ChunkingStrategy,
  type Unit,
} from "@/lib/ingestion/strategies";
import { buildBlocks } from "@/lib/ingestion/structure";
import type { Block } from "@/lib/ingestion/types";
import { buildSamplePdf, buildTwoColumnPdf } from "./helpers/make-pdf";

describe("two-column layout", () => {
  it("reads the left column fully before the right column", async () => {
    const [page] = await extractPages(await buildTwoColumnPdf());
    expect(page?.twoColumn).toBe(true);
    const text = page?.lines.map((l) => l.text).join(" ") ?? "";
    expect(text.indexOf("The left column opens")).toBeLessThan(
      text.indexOf("Investment picked up"),
    );
    const lastLeft = text.indexOf("continues on the right");
    const firstRight = text.indexOf("and finishes here");
    expect(lastLeft).toBeGreaterThan(-1);
    expect(firstRight).toBeGreaterThan(lastLeft);
    expect(text).not.toMatch(/column opens the story[^.]*Investment/);
  });

  it("joins a sentence that continues from the left column into the right", async () => {
    const [page] = await extractPages(await buildTwoColumnPdf());
    const { blocks } = buildBlocks(page ? [page] : []);
    const body = blocks
      .filter((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph")
      .map((b) => b.text)
      .join(" ");
    expect(body).toContain("continues on the right and finishes here in the right column.");
  });

  it("keeps single-column pages untouched", async () => {
    const pages = await extractPages(await buildSamplePdf());
    expect(pages.every((p) => !p.twoColumn)).toBe(true);
  });
});

const sentences = Array.from(
  { length: 24 },
  (_, i) =>
    `Sentence ${i + 1} reports a distinct finding about topic ${Math.floor(i / 6)} in the economy.`,
);
const paragraphBlock = (text: string): Block => ({
  type: "paragraph",
  text,
  breaks: [{ offset: 0, page: 1 }],
  pageStart: 1,
  pageEnd: 1,
});

function chunkWith(strategy: ChunkingStrategy) {
  const blocks: Block[] = [
    { type: "heading", level: 1, text: "Chapter", page: 1 },
    paragraphBlock(sentences.slice(0, 12).join(" ")),
    paragraphBlock(sentences.slice(12).join(" ")),
  ];
  return buildHierarchy(
    "d",
    blocks,
    { strategy, windowSentences: 4, targetTokens: 80, maxTokens: 120, overlapTokens: 20 },
    "Doc",
  ).chunks;
}

describe.each(CHUNKING_STRATEGIES)("chunking strategy %s", (strategy) => {
  const chunks = chunkWith(strategy);

  it("only produces chunks made of whole sentences", () => {
    expect(chunks.length).toBeGreaterThan(1);
    expect(countIncompleteChunks(chunks)).toBe(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("Sentence")).toBe(true);
      expect(chunk.tokenCount).toBeLessThanOrEqual(120);
    }
  });

  it("covers every sentence of the source", () => {
    const joined = chunks.map((c) => c.text).join(" ");
    for (let n = 1; n <= sentences.length; n++) expect(joined).toContain(`Sentence ${n} reports`);
  });
});

describe("strategy specifics", () => {
  const unit = (n: number, paragraphStart = false): Unit => ({
    text: `Sentence ${n}.`,
    page: 1,
    paragraphStart,
    tokens: 5,
  });
  const units = Array.from({ length: 10 }, (_, i) => unit(i + 1, i === 0));

  it("sentence windows overlap by half a window and end at the last sentence", () => {
    const groups = packSentenceWindows(units, {
      targetTokens: 100,
      maxTokens: 100,
      overlapTokens: 0,
      windowSentences: 4,
    });
    expect(groups[0]?.map((u) => u.text)).toEqual([
      "Sentence 1.",
      "Sentence 2.",
      "Sentence 3.",
      "Sentence 4.",
    ]);
    expect(groups[1]?.[0]?.text).toBe("Sentence 3.");
    expect(groups.at(-1)?.at(-1)?.text).toBe("Sentence 10.");
  });

  it("paragraph strategy keeps paragraphs apart", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "C", page: 1 },
      paragraphBlock(`${sentences.slice(0, 4).join(" ")}`),
      paragraphBlock(`${sentences.slice(4, 8).join(" ")}`),
    ];
    const { chunks } = buildHierarchy(
      "d",
      blocks,
      {
        strategy: "paragraph",
        windowSentences: 5,
        targetTokens: 80,
        maxTokens: 120,
        overlapTokens: 0,
      },
      "D",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("Sentence 4 ");
    expect(chunks[0]?.text).not.toContain("Sentence 5 ");
  });

  it("topic similarity drops at a vocabulary change", () => {
    const topic = (words: string, n: number): Unit[] =>
      Array.from({ length: n }, () => ({ text: words, page: 1, paragraphStart: false, tokens: 6 }));
    const similarities = boundarySimilarities([
      ...topic("inflation prices central bank rates", 4),
      ...topic("agriculture harvest rainfall farmers crops", 4),
    ]);
    const lowest = similarities.indexOf(Math.min(...similarities));
    expect(lowest + 1).toBe(4);
  });
});
