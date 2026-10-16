// DI token for the embedding model. Swapping local for hosted embeddings is a
// binding change in EducationModule, measured by the retrieval eval.
export abstract class EmbeddingProvider {
  abstract readonly dimensions: number;
  abstract embedQuery(text: string): Promise<number[]>;
  abstract embedPassages(texts: string[]): Promise<number[][]>;
}
