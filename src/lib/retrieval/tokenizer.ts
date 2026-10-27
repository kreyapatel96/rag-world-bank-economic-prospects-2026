const STOPWORDS = new Set(
  "a an and are as at be been but by for from had has have he her his how i if in into is it its of on or our she so than that the their them then there these they this to was we were what when where which while who why will with would you your".split(
    " ",
  ),
);

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[.,'’\-][\p{L}\p{N}]+)*/gu;

function stem(token: string): string {
  if (/^\d/.test(token) || token.length <= 4) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("sses")) return token.slice(0, -2);
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeToken(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/[’']/g, "");
  if (/^\d/.test(lower)) return [lower.replace(/,(?=\d{3}\b)/g, "")];
  const parts = lower.split("-").filter(Boolean);
  const stems = parts.map(stem);
  return parts.length > 1 ? [stem(lower), ...stems] : stems;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    for (const token of normalizeToken(match[0])) {
      if (token.length > 0 && !STOPWORDS.has(token)) tokens.push(token);
    }
  }
  return tokens;
}

export function extractQuotedPhrases(query: string): string[] {
  return [...query.matchAll(/"([^"]{3,200})"/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

export function normalizeForPhrase(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildSearchText(parts: {
  chapterTitle: string;
  sectionTitle: string;
  subsectionTitle: string;
  text: string;
}): string {
  const path = [parts.chapterTitle, parts.sectionTitle, parts.subsectionTitle]
    .filter(Boolean)
    .join(" > ");
  return path ? `${path}\n${parts.text}` : parts.text;
}
