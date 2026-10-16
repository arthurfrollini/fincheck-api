import Anthropic from '@anthropic-ai/sdk';
import { type Baseline } from '../lib/baseline';
import { type GoldenCase } from './golden-set';
import { EVAL_CATEGORIES } from './runner';
import { parseModels, runEvalSuite, type SuiteIO } from './suite';

const usage = {
  input_tokens: 400,
  output_tokens: 30,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
};
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
  Promise.resolve({
    stop_reason: 'end_turn',
    parsed_output: { categoryId: mercado, confidence: 0.9 },
    usage,
  });
const unauthorized = () =>
  Promise.reject(
    new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()),
  );

function memoryIO(
  initial: Record<string, Baseline & { recordedAt: string }> = {},
) {
  const io = {
    baselines: initial,
    written: undefined as unknown,
    out: undefined as unknown,
    logs: [] as string[],
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
  parse: jest.Mock,
  opts: {
    models?: string[];
    updateBaseline?: boolean;
    cases?: GoldenCase[];
  } = {},
) =>
  runEvalSuite({
    llm: { parse } as never,
    models: (opts.models ?? ['claude-haiku-5-5']) as never,
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

    await expect(run(io, jest.fn(ok))).resolves.toBe(0);

    expect(io.out).toEqual({
      models: {
        'claude-haiku-5-5': expect.objectContaining({
          score: expect.objectContaining({ correct: 4, total: 4 }),
          gate: expect.objectContaining({ status: 'pass' }),
        }),
      },
    });
    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('records a baseline for the gated model only', async () => {
    const io = memoryIO();

    await expect(
      run(io, jest.fn(ok), {
        models: ['claude-haiku-5-5', 'claude-opus-5-5'],
        updateBaseline: true,
      }),
    ).resolves.toBe(0);

    expect(Object.keys(io.written as object)).toEqual(['claude-haiku-5-5']);
  });

  it('re-records a baseline after the golden set changed size instead of crashing', async () => {
    const io = memoryIO({
      'claude-haiku-5-5': { correct: 3, total: 3, recordedAt: 't' },
    });

    await expect(run(io, jest.fn(ok), { updateBaseline: true })).resolves.toBe(
      0,
    );

    expect(
      (io.written as Record<string, Baseline>)['claude-haiku-5-5'],
    ).toEqual(expect.objectContaining({ correct: 4, total: 4 }));
  });

  it('does not write the baseline file when any case errored', async () => {
    const io = memoryIO();
    const parse = jest.fn(ok).mockImplementationOnce(unauthorized);

    await expect(run(io, parse, { updateBaseline: true })).resolves.toBe(1);

    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('does not write the baseline file when the gated model fails as infra', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...cases[0],
      id: `e${i}`,
    }));
    const io = memoryIO();

    await expect(
      run(io, jest.fn(unauthorized), { updateBaseline: true, cases: many }),
    ).resolves.toBe(1);

    expect(io.writeBaselines).not.toHaveBeenCalled();
  });

  it('still prints a report when a model fails as infra', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...cases[0],
      id: `e${i}`,
    }));
    const io = memoryIO();

    await run(io, jest.fn(unauthorized), { cases: many });

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
});
