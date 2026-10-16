-- CreateEnum
CREATE TYPE "agent_run_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'DEGRADED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "question" TEXT NOT NULL,
    "status" "agent_run_status" NOT NULL,
    "answer" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_user_id_idempotency_key_key" ON "agent_runs"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
