/*
  Warnings:

  - You are about to drop the `Transaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_stockId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_userId_fkey";

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "frozenUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bullhornUntil" TIMESTAMP(3),
ADD COLUMN     "netWorth" DECIMAL(15,2) NOT NULL DEFAULT 0.00;

-- DropTable
DROP TABLE "Transaction";

-- DropEnum
DROP TYPE "TransactionType";
