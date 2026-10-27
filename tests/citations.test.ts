import { describe, expect, it } from "vitest";
import { analyzeCitations, formatPageLabel } from "@/lib/citations/citations";
import type { ContextPassage } from "@/lib/context/builder";

const passage = (sourceId: string, pageStart: number, pageEnd: number): ContextPassage => ({
  sourceId,
  chunkIds: [`d-${sourceId}`],
  documentId: "d",
  chapterTitle: "Ch",
  sectionTitle: "Sec",
  subsectionTitle: "",
  pageStart,
  pageEnd,
  text: "t",
  tokens: 1,
  score: 1,
  expanded: false,
});

describe("citations", () => {
  const passages = [passage("S1", 4, 4), passage("S2", 9, 10)];

  it("formats page labels", () => {
    expect(formatPageLabel(4, 4)).toBe("p. 4");
    expect(formatPageLabel(9, 10)).toBe("pp. 9-10");
  });

  it("maps markers to retrieved passages with page ranges", () => {
    const result = analyzeCitations("Growth slowed [S2]. Inflation fell [S1].", passages);
    expect(result.citations.map((c) => [c.sourceId, c.pageLabel])).toEqual([
      ["S1", "p. 4"],
      ["S2", "pp. 9-10"],
    ]);
    expect(result.invalidMarkers).toEqual([]);
  });

  it("removes fabricated source ids instead of citing them", () => {
    const result = analyzeCitations("Claim [S1][S7] and another [S9].", passages);
    expect(result.answer).toBe("Claim [S1] and another .");
    expect(result.citations.map((c) => c.sourceId)).toEqual(["S1"]);
    expect(result.invalidMarkers.sort()).toEqual(["S7", "S9"]);
  });

  it("handles grouped markers and answers with no citations", () => {
    expect(analyzeCitations("Both [S1, S2].", passages).citations).toHaveLength(2);
    expect(analyzeCitations("No markers here.", passages).citations).toEqual([]);
  });
});
