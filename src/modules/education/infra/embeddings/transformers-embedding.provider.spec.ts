import { TransformersEmbeddingProvider } from './transformers-embedding.provider';

function fakeExtractor() {
  return jest.fn((inputs: string[]) =>
    Promise.resolve({
      tolist: () => inputs.map(() => Array.from({ length: 384 }, () => 0.01)),
    }),
  );
}

describe('TransformersEmbeddingProvider', () => {
  it('prefixes queries with "query: " and passages with "passage: ", mean-pooled and normalized', async () => {
    const extractor = fakeExtractor();
    const provider = new TransformersEmbeddingProvider(() =>
      Promise.resolve(extractor),
    );

    await provider.embedQuery('quanto guardar');
    await provider.embedPassages(['reserva financeira']);

    expect(extractor).toHaveBeenNthCalledWith(1, ['query: quanto guardar'], {
      pooling: 'mean',
      normalize: true,
    });
    expect(extractor).toHaveBeenNthCalledWith(
      2,
      ['passage: reserva financeira'],
      { pooling: 'mean', normalize: true },
    );
  });

  it('fails loudly when the model returns no vector for a query', async () => {
    const provider = new TransformersEmbeddingProvider(() =>
      Promise.resolve(
        jest.fn((_inputs: string[]) => Promise.resolve({ tolist: () => [] })),
      ),
    );

    await expect(provider.embedQuery('quanto guardar')).rejects.toThrow(
      /no vector/i,
    );
  });

  it('embeds passages in batches of 32, preserving order', async () => {
    const extractor = fakeExtractor();
    const provider = new TransformersEmbeddingProvider(() =>
      Promise.resolve(extractor),
    );

    const vectors = await provider.embedPassages(
      Array.from({ length: 70 }, (_, i) => `p${i}`),
    );

    expect(extractor.mock.calls.map((c) => c[0].length)).toEqual([32, 32, 6]);
    expect(vectors).toHaveLength(70);
    expect(vectors[0]).toHaveLength(384);
  });

  it('loads the model once across calls', async () => {
    const factory = jest.fn(() => Promise.resolve(fakeExtractor()));
    const provider = new TransformersEmbeddingProvider(factory);

    await Promise.all([provider.embedQuery('a'), provider.embedQuery('b')]);
    await provider.embedPassages(['c']);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retries the model load after a failed one instead of caching the failure', async () => {
    const factory = jest
      .fn<Promise<ReturnType<typeof fakeExtractor>>, []>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(fakeExtractor());
    const provider = new TransformersEmbeddingProvider(factory);

    await expect(provider.embedQuery('a')).rejects.toThrow('network down');
    await expect(provider.embedQuery('a')).resolves.toHaveLength(384);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('preloads the model on module init without failing boot when the load fails', async () => {
    const factory = jest
      .fn<Promise<ReturnType<typeof fakeExtractor>>, []>()
      .mockRejectedValue(new Error('offline'));
    const provider = new TransformersEmbeddingProvider(factory);

    expect(() => provider.onModuleInit()).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  // The real model is not exercised here: onnxruntime rejects typed arrays
  // from Jest's sandboxed globals. The retrieval eval (evals/rag) runs it for
  // real, outside Jest, on every CI run.
});
