import type { ContextPassage } from "@/lib/context/builder";

export interface Citation {
  sourceId: string;
  documentId: string;
  chunkIds: string[];
  pageStart: number;
  pageEnd: number;
  pageLabel: string;
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
}

export interface CitationAnalysis {
  answer: string;
  citations: Citation[];
  invalidMarkers: string[];
}

const MARKER_GROUP = /\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]/gi;

export function formatPageLabel(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}-${pageEnd}`;
}

export function toCitation(passage: ContextPassage): Citation {
  return {
    sourceId: passage.sourceId,
    documentId: passage.documentId,
    chunkIds: passage.chunkIds,
    pageStart: passage.pageStart,
    pageEnd: passage.pageEnd,
    pageLabel: formatPageLabel(passage.pageStart, passage.pageEnd),
    chapterTitle: passage.chapterTitle,
    sectionTitle: passage.sectionTitle,
    subsectionTitle: passage.subsectionTitle,
  };
}

export function analyzeCitations(answer: string, passages: ContextPassage[]): CitationAnalysis {
  const bySourceId = new Map(passages.map((p) => [p.sourceId, p]));
  const cited = new Set<string>();
  const invalid = new Set<string>();

  const cleaned = answer.replace(MARKER_GROUP, (_match, group: string) => {
    const ids = group.split(/[,;]/).map((id) => id.trim().toUpperCase());
    const valid = ids.filter((id) => bySourceId.has(id));
    for (const id of ids) {
      if (bySourceId.has(id)) cited.add(id);
      else invalid.add(id);
    }
    return valid.map((id) => `[${id}]`).join("");
  });

  const citations = [...cited]
    .map((id) => bySourceId.get(id))
    .filter((p): p is ContextPassage => p !== undefined)
    .sort((a, b) => Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1)))
    .map(toCitation);

  return { answer: cleaned.trim(), citations, invalidMarkers: [...invalid] };
}
