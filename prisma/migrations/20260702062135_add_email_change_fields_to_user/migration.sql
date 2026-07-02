/*
  Warnings:

  - A unique constraint covering the columns `[email_token]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_token" TEXT,
ADD COLUMN     "pending_email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_token_key" ON "users"("email_token");
