import { describe, expect, it } from "vitest";
import { buildPostings, scoreBm25 } from "@/lib/retrieval/bm25";
import { reciprocalRankFusion } from "@/lib/retrieval/fusion";
import { extractQuotedPhrases, tokenize } from "@/lib/retrieval/tokenizer";
import type { DraftChunk } from "@/lib/db/schemas";

function chunk(id: string, text: string, section = ""): DraftChunk {
  return {
    _id: id,
    documentId: "d",
    text,
    chapterTitle: "Chapter",
    sectionTitle: section,
    subsectionTitle: "",
    sectionId: "s",
    pageStart: 1,
    pageEnd: 1,
    order: 0,
    charCount: text.length,
    tokenCount: 10,
    kind: "text",
  };
}

describe("tokenizer", () => {
  it("keeps numbers, normalises thousands separators and plurals", () => {
    expect(tokenize("GDP grew 3.5% while 1,200 economies expanded")).toEqual(
      expect.arrayContaining(["gdp", "grew", "3.5", "1200", "economy"]),
    );
  });

  it("indexes hyphenated terms as a whole and as parts", () => {
    expect(tokenize("low-income countries")).toEqual(
      expect.arrayContaining(["low-income", "low", "income", "country"]),
    );
  });

  it("extracts quoted phrases", () => {
    expect(extractQuotedPhrases('what is "foreign direct investment" in 2023')).toEqual([
      "foreign direct investment",
    ]);
  });
});

describe("BM25", () => {
  const chunks = [
    chunk("a", "Inflation in Nigeria reached 24 percent. Inflation remained elevated."),
    chunk("b", "Growth in Kenya was strong and trade expanded."),
    chunk("c", "Nigeria exports oil. Kenya exports tea."),
  ];
  const { postings, stats } = buildPostings("d", chunks);

  it("builds postings with document frequencies and lengths for every chunk", () => {
    const nigeria = postings.find((p) => p.term === "nigeria");
    expect(nigeria?.df).toBe(2);
    expect(Object.keys(stats.lengths).sort()).toEqual(["a", "b", "c"]);
    expect(stats.chunkCount).toBe(3);
  });

  it("ranks the chunk with the rarest, most frequent query terms first", () => {
    const wanted = postings.filter((p) => ["inflation", "nigeria"].includes(p.term));
    const scores = [...scoreBm25(wanted, stats)].sort((x, y) => y[1] - x[1]);
    expect(scores[0]?.[0]).toBe("a");
  });

  it("matches numerical expressions exactly", () => {
    const entry = postings.filter((p) => p.term === "24");
    expect([...scoreBm25(entry, stats).keys()]).toEqual(["a"]);
  });
});

describe("reciprocal rank fusion", () => {
  const semantic = {
    method: "semantic" as const,
    items: [
      { chunkId: "a", score: 0.9 },
      { chunkId: "b", score: 0.8 },
      { chunkId: "c", score: 0.7 },
    ],
  };
  const keyword = {
    method: "keyword" as const,
    items: [
      { chunkId: "c", score: 12 },
      { chunkId: "a", score: 7 },
    ],
  };

  it("rewards chunks found by both retrievers and keeps per-method provenance", () => {
    const fused = reciprocalRankFusion([semantic, keyword], 60);
    expect(fused.map((f) => f.chunkId)).toEqual(["a", "c", "b"]);
    expect(fused[0]?.fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused[0]?.contributions).toEqual([
      { method: "semantic", rank: 1, score: 0.9 },
      { method: "keyword", rank: 2, score: 7 },
    ]);
  });

  it("deduplicates chunk ids and works when one retriever returns nothing", () => {
    const fused = reciprocalRankFusion([{ method: "semantic", items: [] }, keyword], 60);
    expect(fused.map((f) => f.chunkId)).toEqual(["c", "a"]);
  });
});
