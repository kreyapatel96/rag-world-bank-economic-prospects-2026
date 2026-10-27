// Subword tokenizers differ per model and none is exposed for Gemini or Ollama models here.
// A blend of the character and word heuristics is within roughly 10-15% for English prose.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  return Math.max(Math.ceil(text.length / 4), Math.ceil(words * 1.3));
}
