import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { KnowledgeChunksPrismaRepository } from './knowledge-chunks.prisma.repository';

function sqlOf(call: unknown[]): Prisma.Sql {
  return call[0] as Prisma.Sql;
}

describe('KnowledgeChunksPrismaRepository', () => {
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let repository: KnowledgeChunksPrismaRepository;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    repository = new KnowledgeChunksPrismaRepository(
      prisma as unknown as PrismaService,
    );
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

    const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(sql.sql).toContain('<=>');
    expect(sql.sql).toMatch(/ORDER BY/i);
    expect(sql.values).toEqual(expect.arrayContaining(['[0.1,0.2]', 6]));
    expect(sql.sql).not.toContain('0.1,0.2');
    expect(results[0]).toEqual(
      expect.objectContaining({ id: 'c1', page: 3, similarity: 0.85 }),
    );
  });

  it('inserts with ON CONFLICT DO NOTHING and returns the inserted count', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const inserted = await repository.upsertMany([
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

    expect(inserted).toBe(1);
    const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
    expect(sql.sql).toMatch(/ON CONFLICT .* DO NOTHING/i);
    expect(sql.values).toContain('[0.1]');
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
