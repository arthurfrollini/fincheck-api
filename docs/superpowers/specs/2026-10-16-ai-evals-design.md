# AI Evals — Design Spec (part 1: harness + categorization)

**Subsystem D of the AI features RFC** (`2026-10-16-ai-features-rfc.md`, option D3 + D1). Part 1 covers the eval harness, the categorization golden set, the baseline gate and the scheduled workflow. The two halves that need subsystem C to exist land with C's spec: **retrieval metrics** (recall@k, hit rate, MRR over a labeled query set, keyless, in main CI) and the **LLM-as-judge** step for free-text answers (in the scheduled workflow).

## Problem

Subsystem A ships a prompt, a model choice (`claude-haiku-5-5`) and a confidence floor (`0.5`). None of the three has been measured. Unit tests with fixtures prove the plumbing (schema validation, ownership, retries), not the answers: a fixture cannot tell whether Haiku puts "Drogasil" in the right category, or whether a prompt edit made things worse.

Goal: a repeatable number for "how often does categorization pick the category a human would", per model, that a PR can be checked against, without putting an API key or model variance into the main CI pipeline.

## Decisions

1. **Two tiers** (RFC D3 + D1):
   - **Main CI (every push, keyless, deterministic):** the recorded-fixture unit tests that already exist for A, plus unit tests of the eval harness itself (scoring, baseline comparison). Retrieval metrics join this tier with C.
   - **`evals.yml` (monthly schedule + `workflow_dispatch`, real key):** the golden set against the real API, gated on regression against a stored baseline.
2. **Golden set: 50 cases**, about 41 real and 9 synthetic, each tagged `source: real | synthetic`.
   - **Real cases:** merchant names from Arthur's September 2026 Nubank credit card statement plus one account-statement PIX, labeled by Arthur. Person names are excluded, since the repo is public. Values are kept because the model sees them.
   - **Synthetic cases:** they cover what the card statement lacks: INCOME transactions, raw bank-style strings (`PAG*`, `IFD*`, `TED RECEBIDA ...`) and deliberate ambiguity.
   - **Known limitation, recorded in the set's README:** the Nubank app shows cleaned-up merchant names ("99 Food", not the raw `DL*99FOOD`), so the real cases are easier than raw statement text.
3. **Labels are the 12 `DEFAULT_CATEGORIES`** (Portuguese names), plus `none`. The labeling rules are written down (`LABELING.md`: subscriptions/streaming → Lazer, pharmacy/barber → Outro, car insurance → Transporte, and so on), so a label can be defended case by case.
4. **Metric: exact-match accuracy.** Precisely: the category the production decision logic would write, compared to the label. That means after the confidence floor, so an answer below the floor counts as `none`. It is reported overall, by `source` and by expected category, with a confusion list of every miss. Cost (from the same pricing table as production) and p50/p95 latency are reported too.
5. **Gate: regression against a stored baseline**, not an absolute floor.
   - The run fails when Haiku's accuracy drops **more than 2 cases (4 pp on 50)** below `evals/baselines/categorization.json`.
   - Two cases is the variance allowance. Model output is nondeterministic, and one flip should not turn the build red.
   - The baseline changes only through a PR running `npm run eval:categorization -- --update-baseline`, so a legitimate quality change is a reviewed diff.
6. **Model comparison is opt-in:** `workflow_dispatch` input `models` (default `claude-haiku-5-5`). Passing `claude-haiku-5-5,claude-opus-5-5` produces the side-by-side accuracy/cost table that justifies decision 2 of A's spec. Only Haiku is gated; Opus is reported.
   - **No server-side refusal fallback on eval calls.** A fallback would silently answer with a different model and corrupt a per-model comparison. A refusal is scored as a miss and listed.
7. **Same code path as production.** The runner builds requests with A's `buildCategorizationRequest`, calls through `LlmService.parse` (instantiated without Nest), and applies the same floor/`none` logic. That logic is extracted from `CategorizeTransactionService` into a pure `interpretAnswer(parsed): string | null` that both use. An eval that reimplements the prompt measures the copy, not the product.

## Architecture

```
evals/
  categorization/
    golden-set.jsonl      # {id, name, type, value, expected, source, note?}
    LABELING.md           # labeling rules + provenance + known limitations
    run.ts                # CLI: --models, --update-baseline, --out
  lib/
    score.ts              # pure: accuracy, by-source, by-category, misses
    baseline.ts           # pure: compare(result, baseline, tolerance) -> pass/fail + reason
    report.ts             # markdown summary for $GITHUB_STEP_SUMMARY
    *.spec.ts             # unit tests, run in main CI
  baselines/
    categorization.json   # {"claude-haiku-5-5": {"correct": n, "total": 50, "recordedAt": "..."}}
.github/workflows/evals.yml
```

- **Candidate categories:** the 12 defaults with fixed UUIDs, filtered by each case's `type` exactly as production does. Expected labels are names, mapped to those ids by the runner.
- **Concurrency:** 5 requests in flight. Haiku 5.5 latency makes a 50-case run take well under a minute.
- **Run cost:** about $0.003 per Haiku run and about $0.15 per Opus 5.5 run. A full run of all three eval jobs costs about $1.20; the schedule is monthly (changed from nightly on 2026-10-16, when daily would have cost ~$36/month), with on-demand runs after prompt or model changes.
- **`evals/` stays out of the build:** added to `tsconfig.build.json` `exclude`.
- **Tests run in main CI:** `evals/**/*.spec.ts` must run in `npm run test:unit`. Add `evals` to jest `roots` (jest `rootDir` is `src`), or the builder's equivalent. Coverage of `evals/lib` counts.
- **npm script:** `"eval:categorization": "ts-node -r tsconfig-paths/register evals/categorization/run.ts"`. It refuses to run with a missing or `fake-` key, like the fixture recorder.

### `evals.yml`

- Triggers: `schedule` (monthly, 1st at 06:00 UTC) and `workflow_dispatch` with input `models`. **Never `pull_request`**, so the secret is never exposed to fork PRs.
- The job needs no Postgres or Redis; the runner touches no database. It does not import `env.ts`, so no fake env block is needed. It gets `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`.
- Steps: checkout → setup-node (same version as `ci.yml`) → `npm ci` → `npm run eval:categorization -- --models "$MODELS" --out eval-result.json` → append the markdown report to `$GITHUB_STEP_SUMMARY` → upload `eval-result.json` as an artifact.
- The job fails (red) only on a Haiku regression beyond tolerance, or on a run error.

## Failure handling

| Case | Behavior |
|---|---|
| One case's API call fails (429, 5xx, network) | Retried up to 3 times with backoff inside the runner. Still failing → the case is scored as a miss and listed as `error`. If more than 5 cases error, the whole run fails as **infra**, not as a regression, and the baseline is never compared. |
| Refusal / max_tokens / unparsed | Scored as a miss, listed with its outcome. |
| Missing or fake key | Exit non-zero before any call, with a clear message. |
| Golden set has a label not among the 12 defaults + `none` | Exit non-zero before any call. Validated by a unit test that loads the real file. |
| No baseline for a gated model | Run passes and prints the result with "no baseline, run with --update-baseline". |

## Testing (main CI, keyless)

- `score.ts`: accuracy and per-source/per-category breakdown on a hand-built result set; misses listed with expected vs got.
- `baseline.ts`: equal → pass; one or two cases down → pass; three down → fail with a reason naming the delta; improvement → pass, with a suggestion to update the baseline; missing baseline → pass with notice.
- `interpretAnswer`: `none` → null; confidence 0.49 → null; 0.5 → id. `CategorizeTransactionService` keeps passing unchanged, which proves the extraction is behavior-preserving.
- Golden set file: parses, has exactly 50 cases, unique ids, valid labels, both `source` values present, at least 3 INCOME cases.
- Runner: with a fake `LlmService` returning fixtures, it produces a result file in the documented shape, and `--update-baseline` writes the baseline file. No network.

## Out of scope (part 1)

- Retrieval metrics and the LLM-as-judge step. They land with C, reusing `evals/lib`.
- Q&A agent evals: they land with B.
- Multiple runs per case for variance estimation. One run per case, with the 2-case tolerance absorbing variance; revisit if the nightly flaps.
- Prompt tuning or hill-climbing against the set. The set exists to make that possible next, not to do it now.
