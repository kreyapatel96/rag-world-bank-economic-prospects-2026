"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  text: string;
  onCitationClick?: (sourceId: string) => void;
}

const CITATION_LINK = /^#cite-(S\d+)$/;

// Citation markers become links so the markdown renderer can show them as chips.
function linkCitations(text: string): string {
  return text.replace(/\[(S\d+)\]/g, "[$1](#cite-$1)");
}

export function MarkdownAnswer({ text, onCitationClick }: Props) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_ul_ul]:mt-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const match = href ? CITATION_LINK.exec(href) : null;
            if (!match?.[1]) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-700 underline"
                >
                  {children}
                </a>
              );
            }
            const sourceId = match[1];
            return (
              <button
                type="button"
                onClick={() => onCitationClick?.(sourceId)}
                className="mx-0.5 rounded bg-blue-100 px-1.5 py-0.5 align-baseline text-xs font-semibold text-blue-800 hover:bg-blue-200"
                aria-label={`Show reference ${sourceId}`}
              >
                {sourceId}
              </button>
            );
          },
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}
