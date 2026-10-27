# World Bank Report Q&A (RAG)

Retrieval-augmented question answering over a long World Bank economic report. Next.js (App Router), TypeScript strict, Tailwind, MongoDB Atlas (storage and Vector Search), Gemini as the primary LLM, Ollama as fallback and for embeddings.

## How it works

1. **Ingest**: PDF is stored in MongoDB GridFS, text is extracted page by page (`unpdf`/pdf.js, with font sizes and positions), running headers/footers and page numbers are removed, headings are detected (chapter patterns, font-size ranking, numbered headings, all-caps lines), tables are detected from column alignment, and the result is chunked as Document → Chapter → Section → Subsection → Chunk.
2. **Index**: each chunk is embedded with `OLLAMA_EMBEDDING_MODEL` (breadcrumb + text) and stored in MongoDB. A persistent BM25 inverted index (`bm25_postings`, `bm25_stats`) is built from the same text.
3. **Retrieve**: query → Atlas `$vectorSearch` and BM25 in parallel → Reciprocal Rank Fusion → top `RERANK_TOP_K` chunks. If semantic search is unavailable (no Ollama, missing index, model mismatch) retrieval degrades to keyword-only and says so in the UI.
4. **Context**: chunks are grouped by section, expanded to the whole section when several hits share one and it fits, near-duplicates are dropped, and everything is cut to `MAX_CONTEXT_TOKENS`. Each passage carries a source tag (`[S1]`) with pages and section path.
5. **Answer**: the prompt tells the model to use only the passages and cite `[S#]`. Markers that do not match a passage are stripped; the UI shows only citations that map to retrieved text.

No reranker is included: no practical, actively maintained JavaScript cross-encoder was adopted. `RERANK_TOP_K` is the number of fused candidates kept.

### Chunking methods

The method is chosen automatically from `CHUNKING_STRATEGY` (default `hierarchical`); there is no selector in the UI. Each document card has a **How this report was processed** list showing what was actually applied (column-aware reading, cleaning, structure, chunking method, tables, indexing). The API still accepts an optional `strategy` on upload and reprocess. All methods pack **whole sentences**, so a chunk never starts or ends mid-sentence (only a single sentence larger than `CHUNK_MAX_TOKENS` is split, at clause boundaries first). Section, chapter and page metadata are kept by every method, and tables are always their own chunks with headers repeated.

| Method                   | Behaviour                                                                                            | Good for                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `hierarchical` (default) | Sentences packed to `CHUNK_TARGET_TOKENS` inside each section, with sentence overlap                 | General questions, balanced context     |
| `paragraph`              | One chunk per paragraph; tiny paragraphs merged forward, oversized ones split at sentence boundaries | Narrative reports with clear paragraphs |
| `sentence_window`        | Sliding windows of `CHUNK_WINDOW_SENTENCES` sentences, half-window stride                            | Precise fact lookup (small chunks)      |
| `topic_shift`            | Splits where the vocabulary of neighbouring sentences changes most (lexical, no model calls)         | Long sections that mix topics           |

At query time the context builder also expands to the parent section when several hits share it, so small chunks still give the model surrounding context. Compare methods with the evaluation run, not by intuition.

### Two-column pages

Text is read in column order (left column top to bottom, then right), full-width headings and tables break the flow, and a sentence that continues from the left column into the right is joined. Detection is per page (a clear vertical gutter with long text lines on both sides); anything else is read as a single column. Pages read this way are listed in the document's processing notes. Mixed layouts, sidebars and pull-quotes can still interleave.

### Defaults

| Setting                               | Default          | Variable                                                          |
| ------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| Chunking method / window sentences    | hierarchical / 5 | `CHUNKING_STRATEGY`, `CHUNK_WINDOW_SENTENCES`                     |
| Chunk target / max / overlap (tokens) | 400 / 600 / 60   | `CHUNK_TARGET_TOKENS`, `CHUNK_MAX_TOKENS`, `CHUNK_OVERLAP_TOKENS` |
| Candidates per retriever              | 20               | `RETRIEVAL_TOP_K`                                                 |
| Chunks kept after fusion              | 8                | `RERANK_TOP_K`                                                    |
| Context budget (tokens)               | 6000             | `MAX_CONTEXT_TOKENS`                                              |
| RRF constant                          | 60               | `RRF_K`                                                           |
| LLM timeout                           | 60000 ms         | `LLM_TIMEOUT_MS`                                                  |
| Upload limit                          | 50 MB            | `MAX_UPLOAD_SIZE_MB`                                              |

Blank values in `.env.local` fall back to these defaults. Tokens are estimated (`max(chars/4, words*1.3)`), not counted with a model tokenizer. Overlap is measured in whole sentences, so an overlap smaller than one sentence produces none.

Page numbers are the **physical PDF page index** (1-based), which can differ from printed page labels.

## 1. Prerequisites and installation

- Node.js 20.9 or newer (developed on Node 22). Check with `node -v`.
- A MongoDB Atlas cluster, a Gemini API key, and Ollama for embeddings (and optional local chat).

```bash
npm install
cp .env.example .env.local   # then fill in values; never commit this file
```

## 2. MongoDB Atlas

1. Create a cluster (a free M0 works for one report) and a database user.
2. Under Network Access, allow your IP (and Vercel's egress, see deployment).
3. Put the connection string in `MONGODB_URI`.
4. Create collections and standard indexes: `npm run db:init`.

Collections: `documents`, `sections`, `chunks`, `bm25_postings`, `bm25_stats`, `eval_runs`, and GridFS bucket `pdf_files`. A collection alone does not enable vector search; the Vector Search index below is required.

## 3. Atlas Vector Search index

`npm run db:init` creates it (default 768 dimensions for `nomic-embed-text`; use `npm run db:init -- --dimensions=1024` for another model). To create it manually, use Atlas UI → Search → Create Search Index → Atlas Vector Search (JSON editor), collection `chunks`, index name equal to `MONGODB_VECTOR_INDEX_NAME`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "documentId" },
    { "type": "filter", "path": "embeddingModel" }
  ]
}
```

Wait until the index is queryable. The **System status** menu in the UI reports a missing, building, or dimension-mismatched index. Every chunk stores its `embeddingModel`; a document embedded with a different model than currently configured is not searched semantically until reprocessed. If you change to a model with different dimensions, drop and recreate the index with the new `numDimensions`, then reprocess documents.

## 4. Gemini

Create a key in Google AI Studio and set `GEMINI_API_KEY` and `GEMINI_MODEL` (choose a current model from the AI Studio model list; no default is assumed). The key is read only on the server. Transient errors (429 rate limit, 5xx, timeouts, network) are retried up to 3 times with exponential backoff and jitter; invalid credentials and exhausted quota are not retried and trigger fallback immediately.

## 5–6. Ollama and models

Install from <https://ollama.com>, start it (`ollama serve` or the desktop app), then pull models. The app never downloads models on its own.

```bash
ollama pull nomic-embed-text     # required: document and query embeddings (768 dims)
ollama pull <chat-model>         # e.g. llama3.1:8b, then set OLLAMA_CHAT_MODEL to the same name
```

## 7. Run the app

```bash
npm run dev      # http://localhost:3000
npm run build && npm start   # production mode
```

## 8. Ingest the report

Either upload the PDF in the **Documents** tab, or use the CLI (recommended for large files, uses the same pipeline):

```bash
npm run ingest -- /path/to/report.pdf
```

The app holds **one report at a time**: uploading a PDF first deletes every existing document (pages, sections, chunks, keyword index, stored PDF and evaluation runs), then ingests the new one. The UI asks for confirmation, and the upload is refused while another document is still processing. Uploading the same file again simply reprocesses it. Reprocessing replaces the document's chunks, sections, and keyword index. Deleting removes the document, chunks, sections, keyword index, stored PDF, and evaluation runs.

## 9. Evaluation

No sample-question file was present in the workspace when this was built, so none is bundled. Place your supplied questions at `data/eval/questions.json` or `data/eval/questions.csv` (see `data/eval/questions.example.json`; it is a format example and is never loaded). Fields: `id`, `question`, optional `expectedAnswer`, optional `relevantPages` (array, or `"12;15-17"` in CSV). Alternative field names `answer`, `pages`, `reference_answer` are accepted.

```bash
npm run eval -- --mode=gemini_fallback --judge=none          # or --mode=compare|ollama, --judge=gemini|ollama
npm run eval -- --questions=path/to/file.csv --limit=10
```

or use the **Evaluation** tab. Reports are saved to MongoDB (`eval_runs`) and, locally, to `data/eval/results/`.

Metrics: hit rate, Recall@K, Precision@K and MRR (page overlap with `relevantPages`; only labelled questions), citation accuracy (cited passages overlapping labelled pages), latency, provider failure rate and categories. Answer correctness and unsupported-claim rate are **LLM-judged** (judge model selectable; null when `--judge=none`) and are not human-verified. RAGAS is not used. The dashboard shows nothing until a run completes.

## 10. Deploy to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Set all variables from `.env.example` in Project Settings → Environment Variables.
3. In Atlas Network Access allow Vercel (Vercel egress IPs are dynamic; `0.0.0.0/0` with strong credentials is the common choice on non-static plans).
4. Point `OLLAMA_BASE_URL` at a reachable, hosted Ollama endpoint, or accept the limits below.
5. Create the vector index (`npm run db:init`, run locally against the same Atlas cluster).

## 11. What needs external hosting

| Feature                        | Local                                     | Vercel                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini answers                 | yes                                       | yes (needs `GEMINI_API_KEY`)                                                                                                                                                                                                              |
| Embeddings and semantic search | yes                                       | **needs a hosted Ollama** reachable from Vercel; otherwise queries fall back to keyword-only                                                                                                                                              |
| Ollama chat / fallback         | yes                                       | only with a hosted Ollama; unreachable endpoints fail fast (3 s check) and are reported                                                                                                                                                   |
| PDF upload in the UI           | up to `MAX_UPLOAD_SIZE_MB`                | request bodies are capped at about 4.5 MB on Vercel; use `npm run ingest` locally for large reports                                                                                                                                       |
| Ingestion                      | in-process after the response (`after()`) | limited by function duration (`maxDuration = 300`); a 200-page report with Ollama embeddings may exceed it. `runIngestion(documentId)` is independent of Next.js, so it can run in a separate worker, which is what `npm run ingest` does |
| Evaluation                     | UI or CLI                                 | UI limited by function duration; use the CLI for full sets                                                                                                                                                                                |
| Original PDFs                  | GridFS in Atlas                           | GridFS in Atlas (no local disk used)                                                                                                                                                                                                      |

## 12. Known limitations

- The ingestion heuristics (headings, tables, header/footer removal) were validated on a generated PDF and unit tests, **not on the real World Bank report**. Inspect the first ingestion (section counts, processing notes, retrieved chunks) and tune if needed.
- Table extraction is column-alignment based: no ruling lines, no merged cells, no tables continued across pages. Uncertain tables carry an extraction note in the chunk and UI. Scanned PDFs are not supported (no OCR); they fail with a clear error.
- No authentication or rate limiting: anyone with the URL can upload, delete, and spend Gemini quota. Enable Vercel Deployment Protection or add auth before exposing it.
- Chat history is kept in the browser session only.
- No reranker; token counts are estimates; Atlas vector search needs Atlas (or an Atlas local deployment).
- Compare mode does not judge which model is better; use the evaluation run for that.
- Not verified in this build environment: calls against a live MongoDB Atlas cluster, Gemini, or Ollama (no credentials or Ollama installation were available), and a real Vercel deployment.

## Scripts

`npm run dev | build | start | lint | typecheck | test | format | db:init | ingest | eval`

## Layout

```
src/app            pages and API route handlers (documents, ask, compare, evaluate, health)
src/components     UI
src/lib/db         connection, schemas, indexes
src/lib/ingestion  extraction, cleaning, structure, tables, chunker, pipeline, storage
src/lib/retrieval  tokenizer, BM25, vector search, fusion, retriever
src/lib/context    token estimate, context builder, prompt
src/lib/llm        Gemini, Ollama, retry, fallback/compare orchestration
src/lib/citations  citation parsing and formatting
src/lib/evaluation dataset parsing, metrics, judge, runner
scripts            db:init, ingest, eval CLIs
tests              Vitest suites
```
