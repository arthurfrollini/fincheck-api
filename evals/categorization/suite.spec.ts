import Anthropic from '@anthropic-ai/sdk';
import { mock, type MockProxy } from 'jest-mock-extended';
import { type LlmModel } from '../../src/shared/llm/llm-pricing';
import {
  type LlmResult,
  type LlmService,
} from '../../src/shared/llm/llm.service';
import { parsedResult, usage } from '../../test/helpers/llm';
import { type Baseline } from '../lib/baseline';
import { type GoldenCase } from './golden-set';
import { EVAL_CATEGORIES } from './runner';
import {
  parseModels,
  runEvalSuite,
  type StoredBaselines,
  type SuiteIO,
} from './suite';
import { objectContaining } from '../../test/helpers/match';

const tokens = usage({ input_tokens: 400, output_tokens: 30 });
const mercado = EVAL_CATEGORIES.find((c) => c.name === 'Mercado')!.id;

const cases: GoldenCase[] = Array.from({ length: 4 }, (_, i) => ({
  id: `r${i}`,
  name: `Mercado ${i}`,
  type: 'EXPENSE',
  value: 10,
  expected: 'Mercado',
  source: 'real',
}));

const ok = () =>
  Promise.resolve(
    parsedResult({ categoryId: mercado, confidence: 0.9 }, { usage: tokens }),
  );
const llmWith = (impl: () => Promise<LlmResult<unknown>>) => {
  const llm = mock<LlmService>();
  llm.parse.mockImplementation(impl);
  return llm;
};
const unauthorized = () =>
  Promise.reject(
    new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()),
  );

function memoryIO(
  initial: Record<string, Baseline & { recordedAt: string }> = {},
) {
  const io: SuiteIO & {
    baselines: StoredBaselines;
    written: StoredBaselines | undefined;
    out: unknown;
    logs: string[];
  } = {
    baselines: initial,
    written: undefined,
    out: undefined,
    logs: [],
    readBaselines: () => io.baselines,
    writeBaselines: jest.fn((b) => {
      io.written = b;
    }),
    writeOut: jest.fn((_path: string, data: unknown) => {
      io.out = data;
    }),
    log: (s: string) => io.logs.push(s),
    error: (s: string) => io.logs.push(s),
  };
  return io;
}

const run = (
  io: SuiteIO,
  llm: MockProxy<LlmService>,
  opts: {
    models?: LlmModel[];
    updateBaseline?: boolean;
    cases?: GoldenCase[];
  } = {},
) =>
  runEvalSuite({
    llm,
    models: opts.models ?? ['claude-haiku-5-5'],
    cases: opts.cases ?? cases,
    updateBaseline: opts.updateBaseline ?? false,
    out: 'eval-result.json',
    io,
    sleep: () => Promise.resolve(),
  });

describe('runEvalSuite', () => {
  it('writes the result file in the documented shape and passes against an equal baseline', async () => {
    const io = memoryIO({
      'claude-haiku-5-5': { correct: 4, total: 4, recordedAt: 't' },
    });

    await expect(run(io, llmWith(ok))).resolves.toBe(0);

    expect(io.out).toEqual({
      models: {
        'claude-haiku-5-5': objectContaining({
          score: objectContaining({ correct: 4, total: 4 }),
          gate: objectContaining({ status: 'pass' }),
        }),
      },
    });
    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('records a baseline for the gated model only', async () => {
    const io = memoryIO();

    await expect(
      run(io, llmWith(ok), {
        models: ['claude-haiku-5-5', 'claude-opus-5-5'],
        updateBaseline: true,
      }),
    ).resolves.toBe(0);

    expect(Object.keys(io.written ?? {})).toEqual(['claude-haiku-5-5']);
  });

  it('re-records a baseline after the golden set changed size instead of crashing', async () => {
    const io = memoryIO({
      'claude-haiku-5-5': { correct: 3, total: 3, recordedAt: 't' },
    });

    await expect(run(io, llmWith(ok), { updateBaseline: true })).resolves.toBe(
      0,
    );

    expect(io.written?.['claude-haiku-5-5']).toEqual(
      objectContaining({ correct: 4, total: 4 }),
    );
  });

  it('does not write the baseline file when any case errored', async () => {
    const io = memoryIO();
    const llm = llmWith(ok);
    llm.parse.mockImplementationOnce(unauthorized);

    await expect(run(io, llm, { updateBaseline: true })).resolves.toBe(1);

    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('does not write the baseline file when the gated model fails as infra', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...cases[0],
      id: `e${i}`,
    }));
    const io = memoryIO();

    await expect(
      run(io, llmWith(unauthorized), { updateBaseline: true, cases: many }),
    ).resolves.toBe(1);

    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('still prints a report when a model fails as infra', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...cases[0],
      id: `e${i}`,
    }));
    const io = memoryIO();

    await run(io, llmWith(unauthorized), { cases: many });

    expect(io.logs.join('\n')).toMatch(/infra/i);
    expect(io.logs.join('\n')).toContain('claude-haiku-5-5');
  });
});

describe('parseModels', () => {
  it('trims whitespace around model names', () => {
    expect(parseModels('claude-haiku-5-5, claude-opus-5-5')).toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]);
  });

  it('rejects an unknown model before any call', () => {
    expect(() => parseModels('claude-haiku-5-5,claude-haiku')).toThrow(
      /claude-haiku/,
    );
  });

  it('rejects an inherited property name as a model', () => {
    expect(() => parseModels('toString')).toThrow(/Unknown model/);
  });
});
