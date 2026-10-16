# RAG evals

## Retrieval (`npm run eval:retrieval`, main CI, keyless)

Measures whether the chunks retrieved for a question contain the passage that answers it. Uses the production embedding model, the real pgvector search and the ingested corpus. It is deterministic, so any drop against `evals/baselines/retrieval.json` fails the build.

### Query set (`queries.jsonl`)

- **30 in-scope questions**, one per section of the Caderno, plus **5 out-of-scope questions** used only to calibrate `RAG_MIN_SIMILARITY`.
- **All 35 were written by Claude** (`source: claude`); the repo owner delegated this. The rule was to phrase them the way a user asks ("tô enrolado com várias dívidas, por onde eu começo?") and never with the document's own vocabulary. Questions that copy the text make retrieval look better than it is.
- **Labels are evidence snippets**: 5-12 words copied verbatim from the passage that answers the question. A retrieved chunk counts as relevant if it contains a snippet, after whitespace and case normalization. Labels are therefore independent of chunk ids, and comparing chunking strategies does not require relabeling.
- Every snippet is checked against the ingested chunks before scoring. A snippet that occurs nowhere fails the run instead of silently lowering recall.

### First measurement (2026-10-16, multilingual-e5-small, 173 paragraph chunks)

| Metric   | Value |
| -------- | ----- |
| recall@5 | 50.0% |
| hit@1    | 23.3% |
| MRR@10   | 0.338 |

This is a starting point, not a result to defend. Known reasons it is low:

- **Labels are single-passage.** Each question lists only the passage it was written from. Other chunks that also answer it count as misses, so recall is a lower bound.
- **Small model.** multilingual-e5-small (384-d, int8) was chosen so CI needs no key and no spend. A hosted model is the obvious experiment; the provider sits behind `EmbeddingProvider`, so swapping it is one binding.
- **Chunking is untested.** Paragraph chunks with one-paragraph overlap are the first try. Heading-aware chunking is the planned comparison.

### Similarity floor

On the same run, out-of-scope questions peaked at a best-chunk similarity of 0.841, and in-scope questions bottomed at 0.848. `RAG_MIN_SIMILARITY = 0.84` keeps every in-scope question and blocks 4 of the 5 off-topic ones. The gap is thin and was measured on only 5 negatives, so the eval prints it on every run.

## Answer quality (`npm run eval:rag-answers`, scheduled, needs a key)

20 of the in-scope questions (`answers.jsonl`), each with 2-3 key points written by Claude from the passage that answers it. Every answer goes through the production path (local embeddings, pgvector, `claude-sonnet-5-5` with citations). `claude-opus-5-5` then grades it at low effort against a fixed rubric, and the full rubric is in `judge.ts`:

- **grounded:** every claim is supported by the cited passages;
- **coversKeyPoints:** the share of key points conveyed;
- **citesSources:** the answer cites relevant passages.

A case passes when it is grounded, cites sources and covers at least half the key points. The gate fails on a drop of more than 2 cases against `evals/baselines/rag-answers.json`.

**Known judge biases:**

- **Verbosity.** LLM judges favor longer answers. The rubric scores conveyed points, not length, and tells the judge so, but the bias is not eliminated.
- **Same model family.** The judge and the answering model are both Claude. Comparing Sonnet with an answer model from another vendor would need a judge from a third family.

## Runtime note

The embedding model (~120 MB) is downloaded the first time it is used and cached in `TRANSFORMERS_CACHE` (default `.cache/models`). The app starts loading it at boot, without blocking. On a fresh machine with no cache, the first question can still wait for that download.
