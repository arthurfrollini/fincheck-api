import { createHash } from 'crypto';
import { ingestCorpus } from './ingest-corpus';

const pdf = new TextEncoder().encode('fake pdf bytes');
const sha = createHash('sha256').update(pdf).digest('hex');
const page = (n: number, words: number) => ({
  page: n,
  text: Array.from({ length: words }, (_, i) => `p${n}w${i}`).join(' '),
});

function deps(expectedSha = sha) {
  const repository = {
    replaceAll: jest.fn((chunks: unknown[]) => Promise.resolve(chunks.length)),
    searchSimilar: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
  };
  const extractPages = jest.fn().mockResolvedValue([page(1, 50), page(2, 60)]);
  const embeddings = {
    dimensions: 384,
    embedQuery: jest.fn(),
    embedPassages: jest.fn((texts: string[]) =>
      Promise.resolve(texts.map((_, i) => [i])),
    ),
  };
  return {
    repository,
    extractPages,
    input: { pdf, expectedSha, extractPages, embeddings, repository },
  };
}

describe('ingestCorpus', () => {
  it('refuses a document whose hash does not match, before touching anything', async () => {
    const d = deps('other');

    await expect(ingestCorpus(d.input)).rejects.toThrow(/sha256/i);
    expect(d.extractPages).not.toHaveBeenCalled();
    expect(d.repository.replaceAll).not.toHaveBeenCalled();
  });

  it('stores each chunk with its own embedding, keyed by the document hash', async () => {
    const d = deps();

    const result = await ingestCorpus(d.input);

    const stored = d.repository.replaceAll.mock.calls[0][0] as {
      documentSha: string;
      chunkIndex: number;
      page: number;
      embedding: number[];
    }[];
    expect(stored.map((c) => [c.chunkIndex, c.page, c.embedding])).toEqual([
      [0, 1, [0]],
      [1, 2, [1]],
    ]);
    expect(stored.every((c) => c.documentSha === sha)).toBe(true);
    expect(result).toEqual({ chunks: 2, stored: 2 });
  });

  it('re-ingesting replaces the stored chunks instead of adding to them', async () => {
    const d = deps();

    await ingestCorpus(d.input);
    await expect(ingestCorpus(d.input)).resolves.toEqual({
      chunks: 2,
      stored: 2,
    });
    expect(d.repository.replaceAll).toHaveBeenCalledTimes(2);
  });
});
