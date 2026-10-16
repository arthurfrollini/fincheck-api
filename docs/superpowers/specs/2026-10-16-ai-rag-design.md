# RAG over BCB Financial Education Material — Design Spec

**Subsystem C of the AI features RFC** (`2026-10-16-ai-features-rfc.md`: C1a local embeddings, C2a pgvector, paragraph chunking, C4b Citations API). It also completes **subsystem D, part 2**: the keyless retrieval eval in main CI and the LLM-as-judge step in the scheduled eval workflow. Builds on `src/shared/llm/` (subsystem A) and `evals/` (subsystem D part 1).

## Problem

Users ask general money questions ("quanto guardar por mês?", "vale a pena parcelar no cartão?"). A bare model answer is unverifiable. The goal is an answer grounded in an authoritative public source, Banco Central do Brasil's *Caderno de Educação Financeira – Conteúdo Básico*, where every claim points to the exact passage and page it came from.

## Decisions (made during brainstorming)

1. **Corpus: one document**, the *Caderno de Educação Financeira – Conteúdo Básico*, 2nd edition (BCB, 2026), 98 pages, about 27k words.
   - **It is © Banco Central do Brasil, not public domain.** The repo is public, so **the PDF is never committed.**
   - `corpus/manifest.json` records the official URL, the expected SHA-256 and the title. The ingest script downloads the file, verifies the hash and refuses to ingest a different edition.
   - The repo holds only that manifest plus short quoted snippets in the eval query set.
2. **Answer model: `claude-sonnet-5-5`** (owner's choice). Grounded answering over retrieved passages is mid-difficulty work; about $0.01 per question.
3. **Judge model: `claude-opus-5-5`.** A weak judge makes the eval useless.
4. **Embeddings: local**, via `@huggingface/transformers` (transformers.js) running `Xenova/multilingual-e5-small`: 384 dimensions, multilingual, uses the `query: ` / `passage: ` prefixes.
   - No API key and no per-call cost, deterministic, so **the retrieval eval runs in main CI**.
   - Behind an `EmbeddingProvider` abstract class (the repo's DI-token pattern), so moving to a hosted model is a one-line binding change plus a measured eval delta.
   - Pin a transformers.js version published at least two weeks ago.
5. **Storage: pgvector on the existing Postgres.**
   - `docker-compose.yml` and the CI `services.postgres` image change from `postgres:17` to `pgvector/pgvector:pg17`. Same Postgres major, plus the extension.
   - Prisma has no vector type: the column is `Unsupported("vector(384)")`, the migration runs `CREATE EXTENSION IF NOT EXISTS vector`, and similarity search uses `$queryRaw` behind a repository (`KnowledgeChunksRepository`).
   - The index is HNSW with `vector_cosine_ops`.
6. **Chunking: paragraph boundaries, per page, with overlap.**
   - Extract text page by page, which keeps page numbers.
   - Drop repeated running headers and footers: `CADERNO DE EDUCAÇÃO FINANCEIRA`, `SUMÁRIO`, `MÓDULO N` lines, bare page numbers.
   - Split on blank lines, then merge consecutive paragraphs into chunks of about 120–250 words, never crossing a page.
   - Overlap: each chunk starts with the last paragraph of the previous chunk on the same page.
   - This is expected to give a few hundred chunks. The retrieval eval exists to measure this choice against alternatives later, not to settle it now.
7. **Answer mechanics: Citations API.**
   - The top-k chunks (k = 6) are passed as `document` content blocks: `source: { type: 'text', media_type: 'text/plain', data: chunk.text }`, `title: "Caderno de Educação Financeira (BCB), p. N"`, `citations: { enabled: true }`.
   - The response's text blocks carry `citations[]` with the exact `cited_text`. The API returns them, not the model's promise in a prompt.
   - No `output_config.format`: it cannot be combined with citations, and the answer is prose.
8. **Endpoint: synchronous `POST /education/questions`** with `{ question }` (1–500 chars).
   - Authenticated like the rest of the API.
   - Returns `{ answer: string, citations: [{ citedText, page, chunkId }], model }`.
   - A few seconds of latency is acceptable for a Q&A screen. No queue, since this subsystem has no write path to protect.
9. **When retrieval finds nothing relevant, the model is not called.**
   - If the best cosine similarity is below `RAG_MIN_SIMILARITY` (start at 0.80, a multilingual-e5 typical floor, tuned with the eval), the endpoint returns a fixed "not covered by the material" answer with no citations.
   - An answer the model gives without passages is exactly what this subsystem exists to prevent.
   - The system prompt also tells the model to answer only from the documents and to say so when they don't cover the question.
10. **Ingest is a script, not an endpoint.**
    - `npm run rag:ingest` downloads, verifies, chunks, embeds and upserts the corpus.
    - It is idempotent: chunks are keyed by `(documentSha, chunkIndex)`, and re-running with the same document is a no-op.

## Evals (subsystem D, part 2)

### Retrieval: main CI, every push, keyless

- **Query set:** `evals/rag/queries.jsonl`, 30 questions written the way a user would ask, without the document's vocabulary.
  - Example: "quanto eu deveria guardar todo mês?", not "qual o percentual recomendado para a reserva financeira".
  - **All 30 were written by Claude** (the owner delegated this) under that rule, and each is tagged `source: claude`. The provenance is stated in `evals/rag/README.md`.
- **Labels are evidence snippets, not chunk ids.**
  - Each query lists 1–3 short verbatim snippets from the passage that answers it (`"evidence": ["custo de oportunidade refere-se ao preço"]`).
  - A retrieved chunk is relevant when it contains any snippet (whitespace- and case-normalized).
  - Labels therefore **survive chunking changes**. That is what makes "paragraph vs heading-aware chunking" a measurable experiment rather than a re-labeling job.
- **Metrics:** recall@5 (share of queries with at least one relevant chunk in the top 5), hit rate@1 and MRR@10. A labeling script checks that every snippet occurs in the corpus text, so no label points at nothing.
- **Gate:** embeddings and search are deterministic, so the gate is **no drop at all** versus `evals/baselines/retrieval.json`. A drop means a chunking or embedding change made retrieval worse, and the PR has to re-record the baseline deliberately.
- **CI mechanics:**
  - The job downloads the corpus PDF (cached by `actions/cache` keyed on the manifest SHA) and the embedding model (cached on the transformers.js cache dir), then ingests into the pgvector service and runs the eval.
  - **Accepted risk:** main CI now depends on bcb.gov.br being reachable on a cache miss. The cache makes that rare. If the download fails, the step fails with a clear message, never a silent skip.

### Answer quality: scheduled workflow, LLM-as-judge

- **Set:** `evals/rag/answers.jsonl`, 20 of the 30 queries, each with 2–4 `keyPoints` the answer must convey, written by Claude from the cited passage.
- **Judge:** `claude-opus-5-5` with a fixed rubric, using structured output `{ grounded: bool, coversKeyPoints: 0..1, citesSources: bool, reasoning: string }`.
  - **grounded:** every claim in the answer is supported by the cited text; the judge sees the cited passages.
  - **coversKeyPoints:** the share of key points conveyed.
  - **citesSources:** at least one citation, and each one is relevant.
  - The judge runs at low effort, for consistency.
- **Score:** a case passes when it is grounded, cites sources and covers at least half the key points. The gate is regression against `evals/baselines/rag-answers.json` with a 2-case tolerance on 20 (judge variance), the same mechanism as categorization. Judge cost is also reported.
- **Known judge biases, stated in the README:** verbosity bias, and the judge sharing a model family with the answerer. The rubric scores conveyed points, not length. Comparing Sonnet against a different answer model would need a judge from a different family; that is out of scope.
- `evals.yml` gains a `rag-answers` job: same triggers, same secret, Postgres pgvector service, ingest, run.

## Architecture

```
src/modules/education/              # feature module (Clean Architecture, like transactions)
  domain/repositories/knowledge-chunks.repository.ts   # abstract: upsertMany, searchSimilar(embedding, k)
  domain/embedding-provider.ts                          # abstract: embedQuery(text), embedPassages(texts)
  application/answer-question.service.ts                # retrieve → threshold → Claude with citations
  application/chunking.ts                               # pure: pages[] → chunks[]
  infra/database/knowledge-chunks.prisma.repository.ts  # $queryRaw with <=> cosine distance
  infra/embeddings/transformers-embedding.provider.ts   # transformers.js, lazy-loaded singleton pipeline
  infra/http/education.controller.ts                    # POST /education/questions
scripts/rag-ingest.ts
corpus/manifest.json
evals/rag/{queries.jsonl, answers.jsonl, README.md, retrieval.ts, judge.ts, run-*.ts}
```

- `LlmFeature` gains `'rag' | 'judge'`, so cost and usage land in the same Prometheus counters, separated by feature.
- `LlmService` gains a method for non-JSON calls, `complete(feature, params, context)`, which returns the message and records usage. `parse` stays for structured output. Same rules as A: `messages.create`, typed SDK errors propagate, never log content.
- `KnowledgeChunk` Prisma model: `id`, `documentSha`, `chunkIndex`, `page`, `text`, `embedding Unsupported("vector(384)")`, unique `(documentSha, chunkIndex)`.
- `LLM_PRICING` gains `claude-sonnet-5-5` ($2 / $10, cache write $2.50, cache read $0.20).
- The transformers.js model loads lazily on the first query and is reused. The first request after boot pays the load cost (a few seconds); the README notes it.

## Failure matrix

| Case | Behavior |
|---|---|
| Question empty or > 500 chars | 400 (DTO validation) |
| No chunks ingested yet | 503 with "knowledge base not ingested", logged at `error` |
| Best similarity below threshold | 200 with the fixed "not covered" answer, no model call, `fincheck_rag_results{result="not_covered"}` |
| Claude 429 / 5xx / network / timeout | 503 "try again"; the SDK does not retry (`maxRetries: 0`); the client may retry. Usage recorded when a response exists. |
| Refusal | 200 with a fixed "can't help with that" answer; `result="refusal"` |
| Answer with zero citations | Returned, but counted as `result="uncited"`. It is a quality signal for the judge eval, not a user-facing error. |
| Corpus hash mismatch at ingest | Ingest aborts; the existing chunks stay untouched |

## Testing

- **Unit:**
  - **Chunking:** headers stripped; never crosses a page; overlap; size bounds; deterministic.
  - **Answer service** (fake embedding provider, fake repository, `LlmService` fed fixtures with real citation blocks): threshold short-circuits without a model call; citations are mapped to `{citedText, page, chunkId}` by `document_index`; refusal; zero citations; typed errors.
  - **Repository:** the SQL shape (mocked `$queryRaw`).
- **E2E:** with a fake `EmbeddingProvider` and a mocked `LlmService`, `POST /education/questions` against chunks inserted into the real pgvector Postgres. This proves the `vector` column, the HNSW index and the cosine query actually run.
- **Retrieval eval:** real model, real pgvector, in CI (above).
- **Judge:** unit tests of scoring and the pass rule with fixture judge outputs. Real runs only in `evals.yml`.

## Out of scope

- More documents, other BCB series, re-ingest scheduling.
- Heading-aware chunking and hosted embeddings. Both are planned experiments that the retrieval eval makes measurable.
- Streaming answers (SSE), multi-turn conversation, and answer caching.
- Personalization with the user's own transactions. That is subsystem B.
