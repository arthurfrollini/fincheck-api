import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { arrayContaining } from '../../../../../test/helpers/match';
import { PrismaService } from '@shared/database/prisma.service';
import { KnowledgeChunksPrismaRepository } from './knowledge-chunks.prisma.repository';

// The repository passes Prisma.sql fragments, never a template string.
function sqlOf(query: TemplateStringsArray | Prisma.Sql): Prisma.Sql {
  if (!('sql' in query)) throw new Error('expected Prisma.sql');
  return query;
}

describe('KnowledgeChunksPrismaRepository', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let repository: KnowledgeChunksPrismaRepository;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.$queryRaw.mockResolvedValue([]);
    repository = new KnowledgeChunksPrismaRepository(prisma);
  });

  it('searches by cosine distance with the vector as a bound parameter', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'c1',
        documentSha: 'sha',
        chunkIndex: 0,
        page: 3,
        text: 't',
        distance: 0.15,
      },
    ]);

    const results = await repository.searchSimilar([0.1, 0.2], 6);

    const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
    expect(sql.sql).toContain('<=>');
    expect(sql.sql).toMatch(/ORDER BY/i);
    expect(sql.values).toEqual(arrayContaining<unknown>(['[0.1,0.2]', 6]));
    expect(sql.sql).not.toContain('0.1,0.2');
    expect(results[0]).toMatchObject({ id: 'c1', page: 3, similarity: 0.85 });
  });

  it('replaces every stored chunk in one transaction, so editions and chunkers never mix', async () => {
    const tx = mockDeep<Prisma.TransactionClient>();
    tx.$executeRaw.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const stored = await repository.replaceAll([
      {
        documentSha: 'sha',
        chunkIndex: 0,
        page: 1,
        text: 'a',
        embedding: [0.1],
      },
      {
        documentSha: 'sha',
        chunkIndex: 1,
        page: 1,
        text: 'b',
        embedding: [0.2],
      },
    ]);

    expect(stored).toBe(2);
    expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({});
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlOf(tx.$executeRaw.mock.calls[0][0]).values).toContain('[0.1]');
  });

  it('never uses the unsafe raw query APIs', () => {
    const dir = path.join(__dirname, '..', '..');
    const sources = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
  });
});
