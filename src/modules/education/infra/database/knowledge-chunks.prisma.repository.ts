import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { KnowledgeChunksRepository } from '../../domain/repositories/knowledge-chunks.repository';
import {
  type KnowledgeChunk,
  type KnowledgeChunkWithEmbedding,
  type ScoredKnowledgeChunk,
} from '../../entities/KnowledgeChunk';

// pgvector's text input format. Passed as a bound parameter and cast in SQL,
// never interpolated into the query string.
const toVectorLiteral = (embedding: number[]) => `[${embedding.join(',')}]`;

@Injectable()
export class KnowledgeChunksPrismaRepository implements KnowledgeChunksRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async replaceAll(chunks: KnowledgeChunkWithEmbedding[]): Promise<number> {
    // A few hundred rows: one transaction keeps readers from ever seeing a
    // half-replaced corpus.
    await this.prismaService.$transaction(
      async (tx) => {
        await tx.knowledgeChunk.deleteMany({});
        for (const c of chunks) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO knowledge_chunks (id, document_sha, chunk_index, page, text, embedding)
            VALUES (gen_random_uuid(), ${c.documentSha}, ${c.chunkIndex}, ${c.page}, ${c.text}, ${toVectorLiteral(c.embedding)}::vector)
          `);
        }
      },
      { timeout: 60_000 },
    );
    return chunks.length;
  }

  async searchSimilar(
    embedding: number[],
    k: number,
  ): Promise<ScoredKnowledgeChunk[]> {
    const rows = await this.prismaService.$queryRaw<
      (KnowledgeChunk & { distance: number })[]
    >(Prisma.sql`
      SELECT id, document_sha AS "documentSha", chunk_index AS "chunkIndex", page, text,
             embedding <=> ${toVectorLiteral(embedding)}::vector AS distance
      FROM knowledge_chunks
      ORDER BY embedding <=> ${toVectorLiteral(embedding)}::vector
      LIMIT ${k}
    `);
    return rows.map(({ distance, ...chunk }) => ({
      ...chunk,
      similarity: 1 - Number(distance),
    }));
  }

  count(): Promise<number> {
    return this.prismaService.knowledgeChunk.count();
  }

  findAll(): Promise<KnowledgeChunk[]> {
    return this.prismaService.knowledgeChunk.findMany({
      select: {
        id: true,
        documentSha: true,
        chunkIndex: true,
        page: true,
        text: true,
      },
      orderBy: [{ documentSha: 'asc' }, { chunkIndex: 'asc' }],
    });
  }
}
