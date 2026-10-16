import {
  type KnowledgeChunk,
  type KnowledgeChunkWithEmbedding,
  type ScoredKnowledgeChunk,
} from '../../entities/KnowledgeChunk';

export abstract class KnowledgeChunksRepository {
  // Replaces the whole knowledge base atomically. Ingest always stores the
  // complete current corpus, so a new edition, chunker or embedding model
  // never leaves old rows to be retrieved alongside new ones. Returns how
  // many chunks are stored.
  abstract replaceAll(chunks: KnowledgeChunkWithEmbedding[]): Promise<number>;
  abstract searchSimilar(
    embedding: number[],
    k: number,
  ): Promise<ScoredKnowledgeChunk[]>;
  abstract count(): Promise<number>;
  abstract findAll(): Promise<KnowledgeChunk[]>;
}
