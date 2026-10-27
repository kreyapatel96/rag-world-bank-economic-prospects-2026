# World Bank Report Q&A

Ask questions about a long World Bank report and get short answers with page citations.

Next.js · TypeScript · MongoDB Atlas (storage + vector search) · Gemini (main model) · Ollama (fallback + embeddings)

## How it works

1. **Upload** a PDF. It is read page by page (two-column pages are read column by column), headers and footers are removed, headings and tables are detected, and the text is cut into chunks made of whole sentences. Every chunk keeps its chapter, section and page numbers.
2. **Index**: each chunk gets an embedding (Ollama `nomic-embed-text`) and goes into a keyword index (BM25).
3. **Ask**: the question is searched both ways, results are merged (Reciprocal Rank Fusion), and the best passages go to Gemini. If Gemini fails, Ollama answers instead.
4. **Answer** appears on the left; the passages it cites, with page numbers, appear in the **References** panel on the right.

The app holds **one report at a time**: uploading a new PDF deletes the old one and its data (you are asked to confirm).

## What this project uses

**Models**

| Job                        | Model                                                                  | Notes                                       |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Answers (main)             | Google Gemini, set by `GEMINI_MODEL` (tested with `gemini-3.5-flash`)  | via the official `@google/genai` SDK        |
| Answers (fallback / local) | Ollama chat model, set by `OLLAMA_CHAT_MODEL` (tested with `llama3.2`) | runs on your machine                        |
| Embeddings                 | Ollama `nomic-embed-text` (768 dimensions)                             | same model for the report and for questions |

**Chunking** (how the report is cut up)

| Technique                                              | What it does                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Column-aware reading                                   | Two-column pages are read left column, then right column                                                               |
| Section-aware (hierarchical) chunking, **the default** | Chapter → section → subsection; text is packed into chunks of about 400 tokens (max 600) with a small sentence overlap |
| Whole sentences only                                   | Chunks start and end at sentence boundaries; a paragraph is kept whole when it fits                                    |
| Table chunks                                           | Each table row is stored with its column headers                                                                       |
| Metadata on every chunk                                | Chapter, section, subsection, page range and order                                                                     |

Three other methods exist and can be switched with `CHUNKING_STRATEGY` in `.env.local`: `paragraph` (one chunk per paragraph), `sentence_window` (sliding window of 5 sentences) and `topic_shift` (split where the topic changes). Each report's card in the app lists what was actually applied to it.

**Retrieval and answering**

| Step      | Method                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Search    | Semantic (Atlas Vector Search) + keyword (BM25), merged with Reciprocal Rank Fusion                                      |
| Context   | Best passages first, near-duplicates removed, neighbouring chunks of the same section joined, kept within a token budget |
| Prompt    | Answer only from the passages, cite `[S1]`-style sources, say so when the report does not cover the question             |
| Citations | Only sources that were really retrieved are shown, with page numbers                                                     |
| Reranker  | None                                                                                                                     |

## Setup

You need Node.js 20.9+, a MongoDB Atlas cluster, a Gemini API key and [Ollama](https://ollama.com).

```bash
npm install
cp .env.example .env.local        # then fill in the values
ollama pull nomic-embed-text      # embeddings (required)
ollama pull llama3.2              # local chat model (or any model you set in OLLAMA_CHAT_MODEL)
npm run db:init                   # creates indexes, including the vector index
npm run dev                       # http://localhost:3000
```

Main settings in `.env.local`:

| Variable                                                | Meaning                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `MONGODB_URI`                                           | Atlas connection string                                                  |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                        | Gemini key and a model your key can use (for example `gemini-3.5-flash`) |
| `OLLAMA_CHAT_MODEL`                                     | Local fallback model, for example `llama3.2`                             |
| `MAX_CONTEXT_TOKENS`, `RETRIEVAL_TOP_K`, `RERANK_TOP_K` | How much text is retrieved and sent to the model (blank = defaults)      |

Other optional settings (chunk size, timeouts) are in `src/lib/config/env.ts`. Secrets stay on the server and `.env.local` is git-ignored.

### Atlas Vector Search index

`npm run db:init` creates it. To create it by hand in Atlas (collection `chunks`, name = `MONGODB_VECTOR_INDEX_NAME`):

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "documentId" },
    { "type": "filter", "path": "embeddingModel" }
  ]
}
```

The free Atlas tier allows only 3 search indexes in total. If `db:init` says the limit is reached, delete one you do not use. The **System status** menu in the app shows whether MongoDB, the index, Gemini and Ollama are ready.

## Using it

- **Documents tab**: upload the PDF, watch progress, reprocess or delete. The card lists what was done to the report (columns, cleaning, headings, tables, chunking).
- **Chat tab**: pick Gemini with Ollama fallback, Ollama only, or Compare (both side by side).
- **Evaluation tab**: runs the questions in `data/eval/questions.json` (or `.csv`; see `data/eval/questions.example.json` for the format). Add `relevantPages` to get recall and precision. Scores appear only after a real run.

Command line alternatives: `npm run ingest -- report.pdf` and `npm run eval`.

## Known limits

- Headings, tables and columns are found with heuristics. Always check a new PDF's processing notes and a few answers. Brochure-style layouts with three or more columns can mix text.
- No OCR: scanned PDFs are rejected.
- Ollama on a CPU-only machine is slow and follows citation rules less reliably than Gemini.
- Page numbers are PDF page positions, which can differ from the numbers printed on the pages.
- There is no login. Anyone who can open the app can upload, delete and use your Gemini quota, so run it only on your own machine or network.

## Development

`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
