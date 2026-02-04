import prisma from '../prisma';
import { Prisma } from '@prisma/client';

export class StockService {
    static async updateAllStocks() {
        console.log("Running scheduled market decay...");
        await this.applyMarketDecay();
    }

    static async applyMarketDecay() {
        console.log("Running batched market decay...");
        const BATCH_SIZE = 1000;
        let processedCount = 0;
        let cursor: string | undefined = undefined;
        const ONE_HOUR = 60 * 60 * 1000;

        try {
            while (true) {
                const stocks: { id: string }[] = await prisma.stock.findMany({
                    where: {
                        updatedAt: { lt: new Date(Date.now() - ONE_HOUR) },
                        currentPrice: { gt: 10.00 },
                        OR: [
                            { frozenUntil: null },
                            { frozenUntil: { lt: new Date() } }
                        ]
                    },
                    take: BATCH_SIZE,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    select: { id: true },
                    orderBy: { id: 'asc' }
                });

                if (stocks.length === 0) break;

                const stockIds = stocks.map((s: { id: string }) => s.id);

                const count = await prisma.$executeRaw`
                    UPDATE "Stock"
                    SET "currentPrice" = GREATEST("currentPrice" * 0.95, 10.00),
                        "updatedAt" = NOW()
                    WHERE id IN (${Prisma.join(stockIds)})
                `;

                processedCount += Number(count);
                cursor = stocks[stocks.length - 1].id;

                if (stocks.length < BATCH_SIZE) break;

                await new Promise(r => setTimeout(r, 200));
            }

            console.log(`Market decay applied. Total stocks updated: ${processedCount}`);

        } catch (error) {
            console.error("Error applying market decay:", error);
        }
    }
}
