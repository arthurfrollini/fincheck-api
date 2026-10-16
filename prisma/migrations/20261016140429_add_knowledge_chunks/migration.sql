-- pgvector ships in the pgvector/pgvector image; this makes it available
-- to this database.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "document_sha" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_sha_chunk_index_key" ON "knowledge_chunks"("document_sha", "chunk_index");

-- Approximate nearest-neighbour index for cosine distance (<=>). HNSW over
-- IVFFlat: no training step, good recall at this corpus size.
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
