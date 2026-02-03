import prisma from '../prisma';
import { Prisma } from '@prisma/client';

export class StockService {
    static async updateAllStocks() {
        console.log("Running scheduled market decay...");
        await this.applyMarketDecay();
    }

    static async applyMarketDecay() {
        console.log("Running optimized market decay...");

        const result = await prisma.$executeRaw`
            UPDATE "Stock" 
            SET "currentPrice" = GREATEST("currentPrice" * 0.95, 10.00),
                "updatedAt" = NOW() 
            WHERE "updatedAt" < NOW() - INTERVAL '1 hour'
            AND "currentPrice" > 10.00
            AND ("frozenUntil" IS NULL OR "frozenUntil" < NOW())
        `;

        console.log(`Market decay applied. Rows affected: ${result}`);
    }
}
