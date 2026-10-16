# Agent eval

`npm run eval:agent`: scheduled workflow or by hand, needs a real key.

- **Seed:** one synthetic user (`seed.ts`) with 40 transactions in August and September 2026, across the default categories, plus one uncategorized PIX. It is recreated from scratch on every run. The "today" the agent sees is fixed at 2026-10-16, so "mês passado" is always September.
- **Cases:** 10 questions in `cases.jsonl`, written by Claude. Each states how its expected number is derived (period, type, category, sum, max or income minus expenses), and `cases.ts` computes the number from the seed. No expected value is typed by hand, and a test pins the derived values.
- **Grading:**
  - **Number check:** the expected value(s) must appear in the answer, written like money, within a cent. A bare year or day doesn't count.
  - **Grounding judge:** `claude-opus-5-5` must confirm that every number in the answer comes from, or follows arithmetically from, the tool results the run actually saw. A right number with no tool call behind it fails.
  - **Wrong numbers:** fail without calling the judge.
  - **Degraded runs:** a step limit, failing tools or a refusal count as misses.
- **Gate:** a drop of more than 2 of 10 cases against `evals/baselines/agent.json`.
- **Checked without a key (2026-10-16):** calling the real tools over Postgres on the seeded user returns exactly the expected value for all 10 cases. If the agent calls the right tools, every case is answerable.
