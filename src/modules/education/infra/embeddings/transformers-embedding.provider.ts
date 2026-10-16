import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
export class TransformersEmbeddingProvider
  extends EmbeddingProvider
  implements OnModuleInit
{
  readonly dimensions = 384;
  private extractor?: Promise<Extractor>;
  private readonly logger = new Logger(TransformersEmbeddingProvider.name);

  constructor(private readonly factory: ExtractorFactory = loadExtractor) {
    super();
  }

  // Start loading (and on a fresh machine, downloading ~120 MB) at boot, so
  // the first question doesn't pay for it inside an HTTP request. Never
  // blocks or fails boot: a failed preload is retried on first use.
  onModuleInit(): void {
    this.load().catch((err: unknown) =>
      this.logger.warn(
        `Embedding model preload failed, will retry on first use: ${String(err)}`,
      ),
    );
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

  private load(): Promise<Extractor> {
    // Memoize the promise, not the result, so concurrent first calls share
    // one load; forget it on failure so a network blip isn't permanent.
    this.extractor ??= this.factory().catch((err: unknown) => {
      this.extractor = undefined;
      throw err;
    });
    return this.extractor;
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const output = await (await this.load())(inputs, EXTRACT_OPTIONS);
    return output.tolist();
  }
}
