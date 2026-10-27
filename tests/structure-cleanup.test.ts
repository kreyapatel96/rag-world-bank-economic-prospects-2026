import { describe, expect, it } from "vitest";
import { removeRunningHeadersAndFooters } from "@/lib/ingestion/clean-pages";
import { mergeBrokenParagraphs, promoteStandaloneHeadings } from "@/lib/ingestion/structure";
import type { Block, PageContent, PageLine } from "@/lib/ingestion/types";

const paragraph = (text: string, page = 1): Block => ({
  type: "paragraph",
  text,
  breaks: [{ offset: 0, page }],
  pageStart: page,
  pageEnd: page,
});

describe("mergeBrokenParagraphs", () => {
  it("rejoins a sentence interrupted by a figure or page break", () => {
    const merged = mergeBrokenParagraphs([
      paragraph("Private investment is central to delivering sustained", 3),
      paragraph("growth across emerging markets.", 4),
    ]);
    expect(merged).toHaveLength(1);
    const [block] = merged;
    expect(block?.type === "paragraph" && block.text).toBe(
      "Private investment is central to delivering sustained growth across emerging markets.",
    );
    expect(block?.type === "paragraph" && [block.pageStart, block.pageEnd]).toEqual([3, 4]);
  });

  it("removes a hyphen from a word split across the break", () => {
    const [block] = mergeBrokenParagraphs([
      paragraph("shipping volumes haltingly resuming thereaf-"),
      paragraph("ter the conflict."),
    ]);
    expect(block?.type === "paragraph" && block.text).toBe(
      "shipping volumes haltingly resuming thereafter the conflict.",
    );
  });

  it("keeps complete paragraphs and paragraphs that start a new sentence apart", () => {
    expect(
      mergeBrokenParagraphs([paragraph("A full sentence."), paragraph("another one.")]),
    ).toHaveLength(2);
    expect(
      mergeBrokenParagraphs([paragraph("Unfinished text"), paragraph("New Sentence starts here.")]),
    ).toHaveLength(2);
  });
});

describe("promoteStandaloneHeadings", () => {
  it("turns a short unpunctuated line between prose into a subsection heading", () => {
    const blocks = promoteStandaloneHeadings([
      paragraph("Oil prices rose sharply."),
      paragraph("Commodity markets"),
      paragraph("Metal prices were broadly stable."),
    ]);
    expect(blocks[1]).toMatchObject({ type: "heading", level: 3, text: "Commodity markets" });
  });

  it("leaves captions, fragments and sentences as text", () => {
    const blocks = promoteStandaloneHeadings([
      paragraph("oil prices rose sharply,"),
      paragraph("FIGURE 1.1 Global outlook"),
      paragraph("Metal prices were broadly stable."),
      paragraph("It ended here."),
      paragraph("Short sentence."),
      paragraph("Next paragraph."),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(Array(6).fill("paragraph"));
  });
});

describe("running footer removal", () => {
  const line = (text: string, y: number): PageLine => ({
    text,
    column: 0,
    y,
    x0: 36,
    fontSize: 7,
    cells: [{ text, x0: 36, x1: 300 }],
  });
  const page = (n: number, footer: string): PageContent => ({
    pageNumber: n,
    height: 792,
    twoColumn: false,
    lines: [line("Body text of the page continues here in a sentence.", 400), line(footer, 30)],
  });

  it("removes footers that differ by spacing, word order and section name", () => {
    const pages = [
      page(
        1,
        "G L O B A L E C O N O M I C P R O S P E C T S | J U N E 2 0 2 6 S T A T I S T I C A L 167",
      ),
      page(2, "168 G L O B A L E C O N O M I C P R O S P E C T S | J U N E 2 0 2 6"),
      page(
        3,
        "G L O B A L E C O N O M I C P R O S P E C T S | J U N E 2 0 2 6 A P P E N D I X 169",
      ),
      page(
        4,
        "G L O B A L E C O N O M I C P R O S P E C T S | J U N E 2 0 2 6 R E F E R E N C E S",
      ),
      page(5, "G L O B A L E C O N O M I C P R O S P E C T S | J U N E 2 0 2 6 F O R E W O R D"),
    ];
    const { pages: cleaned, removedLines } = removeRunningHeadersAndFooters(pages);
    expect(removedLines).toBe(5);
    expect(cleaned.every((p) => p.lines.length === 1)).toBe(true);
  });
});

describe("tables whose values carry units", () => {
  it("keeps key-value rows instead of dropping the table", async () => {
    const { segmentPage } = await import("@/lib/ingestion/tables");
    const row = (label: string, value: string, y: number): PageLine => ({
      text: `${label} ${value}`,
      column: 0,
      y,
      x0: 100,
      fontSize: 10,
      cells: [
        { text: label, x0: 100, x1: 300 },
        { text: value, x0: 420, x1: 480 },
      ],
    });
    const segments = segmentPage([
      row("Greenhouse gas emissions", "iMac (two ports)", 700),
      row("Total product footprint", "346 kg CO2e", 685),
      row("Apple emissions (scope 2)", "0 kg CO2e", 670),
      row("Life cycle emissions (scope 3)", "346 kg CO2e", 655),
    ]);
    const table = segments.find((s) => s.type === "table");
    expect(table?.type === "table" && table.headers).toEqual([
      "Greenhouse gas emissions",
      "iMac (two ports)",
    ]);
    expect(table?.type === "table" && table.rows).toContainEqual([
      "Total product footprint",
      "346 kg CO2e",
    ]);
  });
});
