import { createHash } from 'crypto';
import { type EmbeddingProvider } from '../domain/embedding-provider';
import { type KnowledgeChunksRepository } from '../domain/repositories/knowledge-chunks.repository';
import { chunkPages, type PageText } from './chunking';

export interface IngestDeps {
  pdf: Uint8Array;
  // The edition the eval labels and citations were checked against. A
  // different file (a new edition at the same URL) must not be ingested
  // silently.
  expectedSha: string;
  extractPages: (pdf: Uint8Array) => Promise<PageText[]>;
  embeddings: EmbeddingProvider;
  repository: KnowledgeChunksRepository;
}

export async function ingestCorpus(
  deps: IngestDeps,
): Promise<{ chunks: number; inserted: number }> {
  const sha = createHash('sha256').update(deps.pdf).digest('hex');
  if (sha !== deps.expectedSha) {
    throw new Error(
      `Corpus sha256 mismatch: expected ${deps.expectedSha}, got ${sha}. The source document changed; review it and update corpus/manifest.json.`,
    );
  }

  const chunks = chunkPages(await deps.extractPages(deps.pdf));
  const embeddings = await deps.embeddings.embedPassages(
    chunks.map((c) => c.text),
  );
  // Keyed by (documentSha, chunkIndex): re-ingesting the same document is a
  // no-op, ingesting a new edition adds its chunks alongside.
  const inserted = await deps.repository.upsertMany(
    chunks.map((c, i) => ({
      ...c,
      documentSha: sha,
      embedding: embeddings[i],
    })),
  );
  return { chunks: chunks.length, inserted };
}
