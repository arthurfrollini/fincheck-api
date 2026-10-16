import { Injectable } from '@nestjs/common';
import { EmbeddingProvider } from '../../domain/embedding-provider';

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
const BATCH_SIZE = 32;
const EXTRACT_OPTIONS = { pooling: 'mean', normalize: true } as const;

type Extractor = (
  inputs: string[],
  options: typeof EXTRACT_OPTIONS,
) => Promise<{ tolist(): number[][] }>;
type ExtractorFactory = () => Promise<Extractor>;

// The model (~120 MB, int8-quantized ONNX) is downloaded on first use into
// TRANSFORMERS_CACHE (default .cache/models, gitignored; cached in CI).
type TransformersModule = typeof import('@huggingface/transformers');

const loadExtractor: ExtractorFactory = async () => {
  // Lazy require, not a top-level import: loading transformers.js pulls in
  // onnxruntime, which every process (and test) that never embeds would pay
  // for at boot. Not import(): Jest can't run dynamic imports without
  // --experimental-vm-modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const transformers: TransformersModule = require('@huggingface/transformers');
  transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE ?? '.cache/models';
  const extractor: unknown = await transformers.pipeline(
    'feature-extraction',
    EMBEDDING_MODEL,
    { dtype: 'q8' },
  );
  return extractor as Extractor;
};

// multilingual-e5 is trained with "query: " / "passage: " prefixes; leaving
// them off measurably hurts retrieval.
@Injectable()
export class TransformersEmbeddingProvider extends EmbeddingProvider {
  readonly dimensions = 384;
  private extractor?: Promise<Extractor>;

  constructor(private readonly factory: ExtractorFactory = loadExtractor) {
    super();
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`query: ${text}`]);
    return vector;
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => `passage: ${t}`);
      vectors.push(...(await this.embed(batch)));
    }
    return vectors;
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    // Memoize the promise, not the result, so concurrent first calls share
    // one model load.
    this.extractor ??= this.factory();
    const output = await (await this.extractor)(inputs, EXTRACT_OPTIONS);
    return output.tolist();
  }
}
