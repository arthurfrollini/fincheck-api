// Retrieval eval: embeds each labeled question with the production
// embedding model, searches the ingested pgvector chunks, and scores the
// rankings against evidence snippets. Keyless and deterministic, so it runs
// in main CI. Needs DATABASE_URL with the corpus ingested (npm run rag:ingest).
//
//   npm run eval:retrieval [-- --update-baseline]
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { KnowledgeChunksPrismaRepository } from '../../src/modules/education/infra/database/knowledge-chunks.prisma.repository';
import { TransformersEmbeddingProvider } from '../../src/modules/education/infra/embeddings/transformers-embedding.provider';
import { RAG_MIN_SIMILARITY } from '../../src/modules/education/application/rag.constants';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { loadQuerySet, validateQuerySet } from './query-set';
import {
  compareRetrieval,
  isRelevant,
  retrievalMetrics,
  separation,
  retrievalMetricsSchema,
} from './retrieval';
import { readJsonFile } from '../lib/json-file';

// Prisma's client loads .env on import, so an explicit DOTENV_PATH must
// override it; without one, values exported in the shell keep precedence.
dotenv.config({
  path: process.env.DOTENV_PATH ?? '.env',
  override: Boolean(process.env.DOTENV_PATH),
});

const BASELINE_FILE = path.resolve(__dirname, '../baselines/retrieval.json');
const K = 10;

async function main(): Promise<number> {
  const prisma = new PrismaService();
  try {
    const repo = new KnowledgeChunksPrismaRepository(prisma);
    const embeddings = new TransformersEmbeddingProvider();
    const queries = loadQuerySet();

    const chunks = await repo.findAll();
    if (chunks.length === 0)
      throw new Error('No chunks ingested. Run npm run rag:ingest first.');
    validateQuerySet(
      queries,
      chunks.map((c) => c.text),
    );

    const rankings: {
      id: string;
      inScope: boolean;
      best: number;
      relevant: boolean[];
    }[] = [];
    for (const q of queries) {
      const results = await repo.searchSimilar(
        await embeddings.embedQuery(q.question),
        K,
      );
      rankings.push({
        id: q.id,
        inScope: q.inScope,
        best: results[0]?.similarity ?? 0,
        relevant: results.map((r) => isRelevant(r.text, q.evidence)),
      });
    }

    const inScope = rankings.filter((r) => r.inScope);
    const metrics = retrievalMetrics(inScope);
    const gap = separation(
      inScope.map((r) => r.best),
      rankings.filter((r) => !r.inScope).map((r) => r.best),
    );
    const baseline = readJsonFile(BASELINE_FILE, retrievalMetricsSchema);
    const updating = process.argv.includes('--update-baseline');
    const gate = updating ? undefined : compareRetrieval(metrics, baseline);

    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(
      [
        `## Retrieval eval (${inScope.length} questions, ${chunks.length} chunks)`,
        '',
        `**recall@5:** ${pct(metrics.recallAt5)} · **hit@1:** ${pct(metrics.hitAt1)} · **MRR@10:** ${metrics.mrrAt10.toFixed(3)}`,
        gate ? `**Gate:** ${gate.status}: ${gate.message}` : '',
        '',
        `**Similarity floor:** in-scope min ${gap.minInScope.toFixed(3)}, out-of-scope max ${gap.maxOutOfScope.toFixed(3)}, ${gap.separable ? `separable, suggested ${gap.suggestedThreshold.toFixed(3)}` : 'NOT separable'}; current RAG_MIN_SIMILARITY ${RAG_MIN_SIMILARITY}.`,
        '',
        'Misses (no relevant chunk in top 5): ' +
          (inScope
            .filter((r) => !r.relevant.slice(0, 5).includes(true))
            .map((r) => r.id)
            .join(', ') || 'none'),
      ].join('\n'),
    );

    if (updating) {
      fs.writeFileSync(
        BASELINE_FILE,
        `${JSON.stringify({ ...metrics, questions: inScope.length, chunks: chunks.length, recordedAt: new Date().toISOString() }, null, 2)}\n`,
      );
    }
    return gate?.status === 'fail' ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
