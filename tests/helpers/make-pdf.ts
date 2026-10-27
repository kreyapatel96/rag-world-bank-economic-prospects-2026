import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const BODY = 10.5;
const LEFT = 60;

interface Cursor {
  page: PDFPage;
  y: number;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildSamplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];

  const newPage = (): Cursor => {
    const page = pdf.addPage([595, 842]);
    pages.push(page);
    page.drawText("Global Economic Prospects", { x: LEFT, y: 815, size: 8, font: regular });
    page.drawText(String(pages.length), { x: 295, y: 25, size: 8, font: regular });
    return { page, y: 770 };
  };

  const heading = (c: Cursor, text: string, size: number) => {
    c.y -= size * 0.8;
    c.page.drawText(text, { x: LEFT, y: c.y, size, font: bold });
    c.y -= size * 1.1;
  };

  const paragraph = (c: Cursor, text: string) => {
    for (const line of wrap(text, regular, BODY, 470)) {
      c.page.drawText(line, { x: LEFT, y: c.y, size: BODY, font: regular });
      c.y -= 13;
    }
    c.y -= 9;
  };

  const filler = (topic: string, n: number) =>
    Array.from(
      { length: n },
      (_, i) => `${topic} sentence number ${i + 1} describes economic conditions in detail.`,
    ).join(" ");

  const first = newPage();
  heading(first, "Chapter 1 Growth Outlook", 22);
  heading(first, "Regional Growth", 15);
  paragraph(
    first,
    `Growth in emerging markets is projected at 4.0 percent in 2025. ${filler("Regional", 12)}`,
  );
  heading(first, "Commodity Prices", 15);
  paragraph(
    first,
    `Oil prices are expected to average 80 dollars per barrel. ${filler("Commodity", 30)}`,
  );

  const second = newPage();
  paragraph(second, `${filler("Continued", 10)}`);
  const tableTop = second.y;
  second.page.drawText("Table 1.1 Regional GDP growth", {
    x: LEFT,
    y: tableTop,
    size: BODY,
    font: bold,
  });
  const rows = [
    ["Region", "2023", "2024", "2025"],
    ["East Asia and Pacific", "5.1", "4.8", "4.5"],
    ["South Asia", "6.2", "6.0", "5.8"],
    ["Sub-Saharan Africa", "3.0", "3.4", "3.9"],
  ];
  const columns = [LEFT, 280, 360, 440];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const font = r === 0 ? bold : regular;
      const x =
        c === 0
          ? (columns[c] ?? LEFT)
          : (columns[c] ?? 0) + 40 - font.widthOfTextAtSize(cell, BODY);
      second.page.drawText(cell, { x, y: tableTop - 18 - r * 15, size: BODY, font });
    });
  });
  second.y = tableTop - 18 - rows.length * 15 - 20;
  heading(second, "Inflation", 15);
  paragraph(second, `Inflation is easing in most economies. ${filler("Inflation", 25)}`);

  const third = newPage();
  heading(third, "Chapter 2 Risks", 22);
  heading(third, "Downside Risks", 15);
  paragraph(third, `Geopolitical tensions could disrupt trade. ${filler("Risk", 20)}`);

  const fourth = newPage();
  heading(fourth, "Chapter 3 Policy Options", 22);
  heading(fourth, "Fiscal Policy", 15);
  paragraph(fourth, `Governments should rebuild fiscal buffers. ${filler("Policy", 15)}`);

  return pdf.save();
}

export async function buildTwoColumnPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText("Annual Review", { x: 60, y: 780, size: 22, font: bold });

  const left =
    "The left column opens the story about trade. Exports rose steadily across the region. Imports of machinery followed the same path. Analysts expect the trend to continue into the next year. Prices for raw materials stayed firm throughout the period. Governments responded with targeted support programs. The final sentence of the left column continues on the right";
  const right =
    "and finishes here in the right column. Investment picked up in services and manufacturing alike. Employment gains were broad based across age groups. Public debt ratios edged lower for most economies. Central banks held rates steady while watching inflation closely. Growth is projected to remain moderate over the medium term.";

  const column = (text: string, x: number) => {
    let y = 740;
    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(candidate, 10.5) > 230 && line) {
        page.drawText(line, { x, y, size: 10.5, font: regular });
        y -= 13;
        line = word;
      } else line = candidate;
    }
    if (line) page.drawText(line, { x, y, size: 10.5, font: regular });
  };
  const repeat = (text: string) => `${text} ${text} ${text}`;
  column(repeat(left), 60);
  column(repeat(right), 310);
  return pdf.save();
}
