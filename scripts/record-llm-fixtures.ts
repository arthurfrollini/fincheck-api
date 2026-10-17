// Re-records the happy-path categorization fixture from a real Claude call,
// so unit tests run against the exact response shape the API returns today.
// Manual only: needs a real ANTHROPIC_API_KEY and spends a fraction of a cent.
// Never runs in CI.
//
//   npm run llm:record-fixtures
//
// Only ok.json is recorded. The other fixtures pin exact values ('none',
// confidence 0.49 / 0.5, refusal, foreign id) that a real call cannot be
// made to reproduce, so they stay handwritten.
import * as fs from 'fs';
import { z } from 'zod';
import * as path from 'path';
import * as dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { buildCategorizationRequest } from '../src/modules/transactions/application/categorize-transaction.service';

dotenv.config();

const FIXTURE = path.resolve(
  __dirname,
  '../test/fixtures/llm/categorization/ok.json',
);

// Same ids the unit tests use; names match DEFAULT_CATEGORIES (EXPENSE).
const EXPENSE_CATEGORIES = [
  { id: 'c0000000-0000-4000-8000-000000000001', name: 'Alimentação' },
  { id: 'c0000000-0000-4000-8000-000000000002', name: 'Mercado' },
  { id: 'c0000000-0000-4000-8000-000000000003', name: 'Casa' },
  { id: 'c0000000-0000-4000-8000-000000000004', name: 'Educação' },
  { id: 'c0000000-0000-4000-8000-000000000005', name: 'Lazer' },
  { id: 'c0000000-0000-4000-8000-000000000006', name: 'Roupas' },
  { id: 'c0000000-0000-4000-8000-000000000007', name: 'Transporte' },
  { id: 'c0000000-0000-4000-8000-000000000008', name: 'Viagem' },
  { id: 'c0000000-0000-4000-8000-000000000009', name: 'Outro' },
];
const EXPECTED_CATEGORY = 'c0000000-0000-4000-8000-000000000002';

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith('fake-')) {
    throw new Error('Set a real ANTHROPIC_API_KEY in .env to record fixtures.');
  }

  const fixture: unknown = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const existing = z
    .object({
      input: z.object({
        name: z.string(),
        type: z.literal('EXPENSE'),
        value: z.number(),
      }),
    })
    .parse(fixture);
  const client = new Anthropic({ apiKey: key, maxRetries: 0 });
  const { params, schema } = buildCategorizationRequest(
    existing.input,
    EXPENSE_CATEGORIES,
    'claude-haiku-5-5',
  );
  const message = await client.messages.create(params);
  const text = message.content.find((b) => b.type === 'text');
  const parsed = schema.safeParse(text ? JSON.parse(text.text) : null);
  const response = {
    ...message,
    parsed_output: parsed.success ? parsed.data : null,
  };

  // The unit tests assert ok.json lands in Mercado above the floor; refuse
  // to overwrite it with an answer that would break them.
  if (response.parsed_output?.categoryId !== EXPECTED_CATEGORY) {
    throw new Error(
      `Not recording: expected ${EXPECTED_CATEGORY}, got ${JSON.stringify(response.parsed_output)}`,
    );
  }

  const recorded = { recorded: true, input: existing.input, ...response };
  fs.writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
  console.log(
    `Recorded ${path.basename(FIXTURE)}: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
