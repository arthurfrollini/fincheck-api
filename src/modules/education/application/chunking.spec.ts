import { chunkPages, MAX_CHUNK_WORDS, MIN_CHUNK_WORDS } from './chunking';
import { must } from '../../../../test/helpers/must';

const words = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Mimics pdftotext output: running header lines, blank-line paragraphs,
// hard-wrapped lines inside a paragraph, a bare page number.
function page(paragraphs: string[]): string {
  return [
    'CADERNO DE EDUCAÇÃO FINANCEIRA',
    '',
    'MÓDULO 1',
    '',
    ...paragraphs.flatMap((p) => [
      p.replace(/(\S+ \S+ \S+ \S+ \S+) /g, '$1\n'),
      '',
    ]),
    '20',
    '',
    'SUMÁRIO',
  ].join('\n');
}

describe('chunkPages', () => {
  const pages = [
    {
      page: 1,
      text: page([
        words(60, 'a'),
        words(70, 'b'),
        words(80, 'c'),
        words(90, 'd'),
      ]),
    },
    { page: 2, text: page([words(40, 'e'), words(30, 'f')]) },
  ];
  const chunks = chunkPages(pages);

  it('strips running headers, module lines and bare page numbers', () => {
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).not.toContain('CADERNO DE EDUCAÇÃO FINANCEIRA');
    expect(all).not.toContain('SUMÁRIO');
    expect(all).not.toContain('MÓDULO 1');
    expect(all).not.toMatch(/(^|\s)20(\s|$)/);
  });

  it('rejoins hard-wrapped lines inside a paragraph', () => {
    expect(must(chunks[0], 'a chunk').text).toContain('a3 a4 a5 a6');
  });

  it('never crosses a page boundary', () => {
    for (const c of chunks) {
      const hasPage1 = /\b[abcd]\d+\b/.test(c.text);
      const hasPage2 = /\b[ef]\d+\b/.test(c.text);
      expect(hasPage1 && hasPage2).toBe(false);
    }
    expect(chunks.filter((c) => c.page === 2)).toHaveLength(1);
  });

  it('keeps chunks within the word bounds, except a page tail', () => {
    const byPage = (p: number) => chunks.filter((c) => c.page === p);
    for (const p of [1, 2]) {
      const list = byPage(p);
      list.forEach((c, i) => {
        expect(wc(c.text)).toBeLessThanOrEqual(MAX_CHUNK_WORDS + 90);
        if (i < list.length - 1)
          expect(wc(c.text)).toBeGreaterThanOrEqual(MIN_CHUNK_WORDS);
        expect(wc(c.text)).toBeGreaterThan(0);
      });
    }
  });

  it('starts each chunk on a page with the previous chunk last paragraph', () => {
    const page1 = chunks.filter((c) => c.page === 1);
    expect(page1.length).toBeGreaterThan(1);
    const [first, ...rest] = page1;
    let previous = must(first, 'a page-1 chunk');
    for (const chunk of rest) {
      const overlap = must(previous.text.split('\n\n').at(-1), 'a paragraph');
      expect(chunk.text.startsWith(overlap)).toBe(true);
      previous = chunk;
    }
  });

  it('numbers chunks contiguously from 0', () => {
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('splits a single paragraph longer than the maximum on sentences', () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `Frase numero ${i} tem cinco palavras.`,
    ).join(' ');
    const out = chunkPages([{ page: 1, text: long }]);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out)
      expect(wc(c.text)).toBeLessThanOrEqual(MAX_CHUNK_WORDS * 2);
  });

  it('is deterministic', () => {
    expect(chunkPages(pages)).toEqual(chunks);
  });

  it('skips empty pages', () => {
    expect(chunkPages([{ page: 1, text: '\n\n12\n' }])).toEqual([]);
  });
});
