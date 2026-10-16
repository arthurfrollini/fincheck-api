export interface KnowledgeChunk {
  id: string;
  documentSha: string;
  chunkIndex: number;
  page: number;
  text: string;
}

export type KnowledgeChunkWithEmbedding = Omit<KnowledgeChunk, 'id'> & {
  embedding: number[];
};

export type ScoredKnowledgeChunk = KnowledgeChunk & {
  // Cosine similarity, 1 = identical direction.
  similarity: number;
};
