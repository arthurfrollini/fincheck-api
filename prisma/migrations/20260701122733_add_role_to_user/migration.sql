/*
  Warnings:

  - You are about to drop the column `bane` on the `transactions` table. All the data in the column will be lost.
  - Added the required column `name` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "role" AS ENUM ('ADMINISTRATOR', 'USER');

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "bane",
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "role" NOT NULL DEFAULT 'USER';
