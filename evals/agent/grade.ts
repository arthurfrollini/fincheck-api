import { z } from 'zod';
import { type LlmService } from '@shared/llm/llm.service';
import { type TraceEntry } from '@modules/assistant/application/run-agent.service';

// Something reads as an amount when it is written like money: an R$ prefix,
// a decimal part (",37" or ".37") or Brazilian thousands separators. A bare
// "2026" or "30" (a year, a day) is not.
const AMOUNT =
  /(R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+,\d{2}|\d+\.\d{2}|\d+)(?![\d.,]*\d)/g;

export function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const [, currency, raw] = m;
    const looksLikeMoney = currency || /[.,]/.test(raw);
    if (!looksLikeMoney) continue;
    const normalized = /,\d{2}$/.test(raw)
      ? raw.replace(/\./g, '').replace(',', '.')
      : /^\d{1,3}(\.\d{3})+$/.test(raw)
        ? raw.replace(/\./g, '')
        : raw;
    amounts.push(Number(normalized));
  }
  return amounts;
}

// Every expected value must appear, within a cent (rounding in the answer).
export function matchesExpected(answer: string, expected: number[]): boolean {
  const amounts = extractAmounts(answer);
  return expected.every((v) => amounts.some((a) => Math.abs(a - v) <= 0.01));
}

export const GROUNDING_JUDGE_MODEL = 'claude-opus-5-5' as const;

const groundingSchema = z.object({
  reasoning: z.string(),
  grounded: z.boolean(),
});
export type GroundingVerdict = z.infer<typeof groundingSchema>;

const GROUNDING_SYSTEM_PROMPT = `You check answers from a personal finance assistant that answers questions by calling tools over the user's transactions.

You get the question, the final answer, and every tool call the assistant made with its result. Decide whether every number in the answer is supported by the tool results: either present in them, or a direct arithmetic consequence of them (for example income minus expenses). A number that appears nowhere and can't be derived from the tool results makes the answer ungrounded, even if it happens to be right.

Write brief reasoning first, then the verdict.`;

// The hand-built JSON schema keeps the API in charge of the shape.
const GROUNDING_JSON_SCHEMA = {
  type: 'object',
  properties: { reasoning: { type: 'string' }, grounded: { type: 'boolean' } },
  required: ['reasoning', 'grounded'],
  additionalProperties: false,
};

export async function judgeGrounding(
  llm: Pick<LlmService, 'parse'>,
  input: { question: string; answer: string; trace: TraceEntry[] },
): Promise<GroundingVerdict | null> {
  const body = [
    `<question>${input.question}</question>`,
    `<answer>${input.answer}</answer>`,
    '<tool_calls>',
    ...input.trace.map(
      (t, i) =>
        `<call index="${i + 1}" tool="${t.tool}" error="${t.isError}">\n<input>${JSON.stringify(t.input)}</input>\n<result>${JSON.stringify(t.result)}</result>\n</call>`,
    ),
    '</tool_calls>',
  ].join('\n');

  const res = await llm.parse(
    'judge',
    {
      model: GROUNDING_JUDGE_MODEL,
      max_tokens: 2048,
      system: GROUNDING_SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: GROUNDING_JSON_SCHEMA },
      },
      messages: [{ role: 'user', content: body }],
    },
    groundingSchema,
  );
  return res.parsed_output;
}
