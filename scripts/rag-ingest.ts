// Downloads the corpus named in corpus/manifest.json (cached under
// .cache/corpus/), verifies its sha256, chunks, embeds locally and stores
// it in pgvector. Idempotent: re-running with the same document inserts
// nothing. Needs DATABASE_URL and poppler's pdftotext.
//
//   npm run rag:ingest
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ingestCorpus } from '../src/modules/education/application/ingest-corpus';
import { extractPdfPagesFromBytes } from '../src/modules/education/infra/corpus/pdf-pages';
import { KnowledgeChunksPrismaRepository } from '../src/modules/education/infra/database/knowledge-chunks.prisma.repository';
import { TransformersEmbeddingProvider } from '../src/modules/education/infra/embeddings/transformers-embedding.provider';
import { type PrismaService } from '../src/shared/database/prisma.service';

// override: Prisma's client already loaded .env on import; DOTENV_PATH must win.
dotenv.config({ path: process.env.DOTENV_PATH ?? '.env', override: true });

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'corpus/manifest.json'), 'utf8'),
) as { url: string; sha256: string; title: string };

async function loadPdf(): Promise<Uint8Array> {
  const cached = path.join(ROOT, '.cache/corpus', `${manifest.sha256}.pdf`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const res = await fetch(manifest.url);
  if (!res.ok) {
    throw new Error(
      `Corpus download failed: HTTP ${res.status} from ${manifest.url}`,
    );
  }
  const pdf = new Uint8Array(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, pdf);
  return pdf;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await ingestCorpus({
      pdf: await loadPdf(),
      expectedSha: manifest.sha256,
      extractPages: extractPdfPagesFromBytes,
      embeddings: new TransformersEmbeddingProvider(),
      repository: new KnowledgeChunksPrismaRepository(
        prisma as unknown as PrismaService,
      ),
    });
    console.log(
      `${manifest.title}: ${result.chunks} chunks, ${result.inserted} newly inserted.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
