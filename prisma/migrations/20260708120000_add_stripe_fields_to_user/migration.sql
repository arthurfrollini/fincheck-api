-- AlterTable
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" TEXT UNIQUE,
ADD COLUMN "stripe_price_id" TEXT;
