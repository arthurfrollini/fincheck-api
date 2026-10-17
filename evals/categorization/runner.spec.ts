import { must, nthCall, only } from '../../test/helpers/must';
import Anthropic from '@anthropic-ai/sdk';
import { mock } from 'jest-mock-extended';
import { type LlmService } from '../../src/shared/llm/llm.service';
import { parsedResult, usage } from '../../test/helpers/llm';
import {
  EVAL_CATEGORIES,
  assertRealKey,
  canUpdateBaseline,
  runCategorizationEval,
  shouldFailAsInfra,
} from './runner';
import { type GoldenCase } from './golden-set';

const idOf = (name: string, type: 'INCOME' | 'EXPENSE') =>
  must(
    EVAL_CATEGORIES.find((c) => c.name === name && c.type === type),
    `category ${name}`,
  ).id;

const tokens = usage({ input_tokens: 400, output_tokens: 30 });

function answer(categoryId: string, confidence = 0.9) {
  return parsedResult({ categoryId, confidence }, { usage: tokens });
}

const expense: GoldenCase = {
  id: 'r1',
  name: 'Assaí Atacadista',
  type: 'EXPENSE',
  value: 50,
  expected: 'Mercado',
  source: 'real',
};
const income: GoldenCase = {
  id: 's3',
  name: 'RENDIMENTO POUPANCA',
  type: 'INCOME',
  value: 12,
  expected: 'Outro',
  source: 'synthetic',
};

const noSleep = () => Promise.resolve();

// One case in, its result out.
async function runOne(options: Parameters<typeof runCategorizationEval>[0]) {
  return only(await runCategorizationEval(options), 'case result');
}

describe('runCategorizationEval', () => {
  it('maps a correct answer back to the expected category name', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(answer(idOf('Mercado', 'EXPENSE')));

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r).toEqual(
      expect.objectContaining({ id: 'r1', got: 'Mercado', outcome: 'ok' }),
    );
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('resolves Outro through the case type, so INCOME Outro is not EXPENSE Outro', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(answer(idOf('Outro', 'INCOME')));

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [income],
      sleep: noSleep,
    });

    expect(r.got).toBe('Outro');
    const params = nthCall(llm.parse.mock)[1];
    const { content } = must(params.messages[0], 'the user message');
    expect(content).toContain(idOf('Outro', 'INCOME'));
    expect(content).not.toContain(idOf('Outro', 'EXPENSE'));
  });

  it('applies the production confidence floor', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(answer(idOf('Mercado', 'EXPENSE'), 0.4));

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r.got).toBe('none');
  });

  it('records a refusal as a miss with no answer', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(
      parsedResult(null, { stop_reason: 'refusal', usage: tokens }),
    );

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r).toEqual(
      expect.objectContaining({ got: null, outcome: 'refusal' }),
    );
  });

  it('retries a rate limit and then succeeds', async () => {
    const llm = mock<LlmService>();
    llm.parse
      .mockRejectedValueOnce(
        new Anthropic.RateLimitError(429, undefined, 'x', new Headers()),
      )
      .mockResolvedValueOnce(answer(idOf('Mercado', 'EXPENSE')));

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r.outcome).toBe('ok');
    expect(llm.parse).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 server errors and records outcome error', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockRejectedValue(
      new Anthropic.InternalServerError(500, undefined, 'x', new Headers()),
    );

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r).toEqual(expect.objectContaining({ got: null, outcome: 'error' }));
    expect(llm.parse).toHaveBeenCalledTimes(3);
  });

  it('does not retry an authentication error', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockRejectedValue(
      new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()),
    );

    const r = await runOne({
      llm,
      model: 'claude-haiku-5-5',
      cases: [expense],
      sleep: noSleep,
    });

    expect(r.outcome).toBe('error');
    expect(llm.parse).toHaveBeenCalledTimes(1);
  });
});

describe('run guards', () => {
  it('fails as infra above 5 errored cases', () => {
    expect(shouldFailAsInfra(5)).toBe(false);
    expect(shouldFailAsInfra(6)).toBe(true);
  });

  it('refuses to update the baseline when any case errored', () => {
    expect(canUpdateBaseline(0)).toBe(true);
    expect(canUpdateBaseline(1)).toBe(false);
  });

  it('refuses a missing or fake key', () => {
    expect(() => assertRealKey(undefined)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => assertRealKey('fake-anthropic-key')).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => assertRealKey('sk-ant-real')).not.toThrow();
  });
});
