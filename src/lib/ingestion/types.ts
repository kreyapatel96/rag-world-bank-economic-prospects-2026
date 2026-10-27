export interface TextCell {
  text: string;
  x0: number;
  x1: number;
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export type ColumnId = 0 | 1 | 2;

export interface PageLine {
  text: string;
  column: ColumnId;
  y: number;
  x0: number;
  fontSize: number;
  cells: TextCell[];
}

export interface PageContent {
  pageNumber: number;
  height: number;
  twoColumn: boolean;
  lines: PageLine[];
}

export interface PageBreak {
  offset: number;
  page: number;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string; page: number }
  | { type: "paragraph"; text: string; breaks: PageBreak[]; pageStart: number; pageEnd: number }
  | {
      type: "table";
      caption: string;
      headers: string[];
      rows: string[][];
      page: number;
      note?: string;
    };
