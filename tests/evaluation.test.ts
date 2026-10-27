import { describe, expect, it } from "vitest";
import { parseQuestions, parsePageSpec } from "@/lib/evaluation/dataset";
import { citationAccuracy, retrievalMetrics } from "@/lib/evaluation/metrics";
import { sanitizeFilename } from "@/lib/documents/service";

const range = (pageStart: number, pageEnd = pageStart) => ({ pageStart, pageEnd });

describe("retrieval metrics", () => {
  const retrieved = [range(3), range(10, 11), range(20), range(40)];

  it("computes recall, precision, hit and reciprocal rank at K", () => {
    const m = retrievalMetrics(retrieved, [10, 40, 99], 4);
    expect(m.hit).toBe(true);
    expect(m.recall).toBeCloseTo(2 / 3);
    expect(m.precision).toBeCloseTo(2 / 4);
    expect(m.reciprocalRank).toBeCloseTo(1 / 2);
  });

  it("respects the K cutoff and reports a miss", () => {
    const m = retrievalMetrics(retrieved, [40], 2);
    expect(m).toEqual({ hit: false, recall: 0, precision: 0, reciprocalRank: 0 });
  });

  it("scores citation accuracy only when citations exist", () => {
    expect(citationAccuracy([range(10, 11), range(3)], [10])).toBe(0.5);
    expect(citationAccuracy([], [10])).toBeNull();
  });
});

describe("question files", () => {
  it("parses page specs with ranges and lists", () => {
    expect(parsePageSpec("12; 15-17")).toEqual([12, 15, 16, 17]);
    expect(parsePageSpec([3, "4"])).toEqual([3, 4]);
    expect(parsePageSpec("none")).toBeUndefined();
  });

  it("parses JSON and CSV with quoted fields", () => {
    const json = parseQuestions(
      JSON.stringify([{ id: "a", question: "Q1?", expected_answer: "A1", pages: "5" }]),
      "json",
    );
    expect(json).toEqual([{ id: "a", question: "Q1?", expectedAnswer: "A1", relevantPages: [5] }]);
    const csv = parseQuestions(
      'id,question,expectedAnswer,relevantPages\n1,"Why, exactly?","Because ""x""","7;9"\n',
      "csv",
    );
    expect(csv[0]).toMatchObject({
      id: "1",
      question: "Why, exactly?",
      expectedAnswer: 'Because "x"',
      relevantPages: [7, 9],
    });
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseQuestions(
        JSON.stringify([
          { id: "a", question: "x" },
          { id: "a", question: "y" },
        ]),
        "json",
      ),
    ).toThrow();
  });
});

describe("filename sanitising", () => {
  it("strips paths and unsafe characters and forces a pdf extension", () => {
    expect(sanitizeFilename("../../etc/pass<wd>.pdf")).toBe("pass_wd_.pdf");
    expect(sanitizeFilename("C:\\x\\Report 2024")).toBe("Report 2024.pdf");
  });
});
