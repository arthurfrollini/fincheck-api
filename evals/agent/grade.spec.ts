import { extractAmounts, matchesExpected } from './grade';

describe('extractAmounts', () => {
  it.each([
    ['Você gastou R$ 302,37 em setembro.', [302.37]],
    ['Total: R$ 1.800,00', [1800]],
    ['foram 8.212,37 reais', [8212.37]],
    ['o valor foi 412.37', [412.37]],
    ['R$ 1.800 de aluguel', [1800]],
    ['agosto: R$ 595,45; setembro: R$ 562,45', [595.45, 562.45]],
  ])('%s → %o', (text, expected) => {
    expect(extractAmounts(text)).toEqual(expect.arrayContaining(expected));
  });
});

describe('matchesExpected', () => {
  it('requires every expected value to appear, within a cent', () => {
    expect(matchesExpected('R$ 595,45 e R$ 562,45', [595.45, 562.45])).toBe(
      true,
    );
    expect(matchesExpected('R$ 595,45 apenas', [595.45, 562.45])).toBe(false);
    expect(matchesExpected('R$ 302,38', [302.37])).toBe(true);
    expect(matchesExpected('R$ 302,40', [302.37])).toBe(false);
  });

  it('does not match a year or a day as an amount by accident', () => {
    expect(
      matchesExpected('Em setembro de 2026 você não teve gastos.', [2026]),
    ).toBe(false);
  });
});
