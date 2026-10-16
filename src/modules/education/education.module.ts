import { Module } from '@nestjs/common';
import { AnswerQuestionService } from './application/answer-question.service';
import { EmbeddingProvider } from './domain/embedding-provider';
import { KnowledgeChunksRepository } from './domain/repositories/knowledge-chunks.repository';
import { KnowledgeChunksPrismaRepository } from './infra/database/knowledge-chunks.prisma.repository';
import { TransformersEmbeddingProvider } from './infra/embeddings/transformers-embedding.provider';
import { EducationController } from './infra/http/education.controller';

@Module({
  controllers: [EducationController],
  providers: [
    AnswerQuestionService,
    {
      provide: KnowledgeChunksRepository,
      useClass: KnowledgeChunksPrismaRepository,
    },
    // Local model today; a hosted provider is a one-line swap here, measured
    // by the retrieval eval.
    // useFactory, not useClass: the constructor's optional model loader is
    // a test seam, not something Nest should try to inject.
    {
      provide: EmbeddingProvider,
      useFactory: () => new TransformersEmbeddingProvider(),
    },
  ],
})
export class EducationModule {}
