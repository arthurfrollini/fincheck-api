import {
  type KnowledgeChunk,
  type KnowledgeChunkWithEmbedding,
  type ScoredKnowledgeChunk,
} from '../../entities/KnowledgeChunk';

export abstract class KnowledgeChunksRepository {
  // Idempotent: a chunk already stored for (documentSha, chunkIndex) is left
  // untouched. Returns how many rows were actually inserted.
  abstract upsertMany(chunks: KnowledgeChunkWithEmbedding[]): Promise<number>;
  abstract searchSimilar(
    embedding: number[],
    k: number,
  ): Promise<ScoredKnowledgeChunk[]>;
  abstract count(): Promise<number>;
  abstract findAll(): Promise<KnowledgeChunk[]>;
}
