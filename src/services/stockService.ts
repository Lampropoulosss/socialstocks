import prisma from '../prisma';

export class StockService {
    static async updateAllStocks() {
        console.log("Running scheduled market decay...");
        await this.applyMarketDecay();
    }

    static async applyMarketDecay() {
        const result = await prisma.$executeRaw`
            UPDATE "Stock" 
            SET "currentPrice" = GREATEST("currentPrice" * 0.95, 10.00),
                "updatedAt" = NOW() 
            WHERE "updatedAt" < NOW() - INTERVAL '1 hour'
            AND "currentPrice" > 10.00
        `;
        console.log("Market decay applied to inactive stocks.");
    }
}
