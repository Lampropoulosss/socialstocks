-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "maxHoldingPerUser" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "sharesOutstanding" INTEGER NOT NULL DEFAULT 0;
