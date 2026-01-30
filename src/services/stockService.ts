import prisma from '../prisma';

export class StockService {
    // We removed 'updateStockPrice' because ActivityService now handles growth.
    // This service is now dedicated to Market Decay (inactive users).

    static async updateAllStocks() {
        console.log("Running scheduled market decay...");
        await this.applyMarketDecay();
    }

    static async applyMarketDecay() {
        // Decay stocks that haven't been updated in 1 hour
        // Floor price at 0.10
        const result = await prisma.$executeRaw`
            UPDATE "Stock" 
            SET "currentPrice" = GREATEST("currentPrice" * 0.95, 0.10),
                "updatedAt" = NOW() 
            WHERE "updatedAt" < NOW() - INTERVAL '1 hour'
        `;
        // Note: result is a number (count) or object depending on driver
        console.log("Market decay applied to inactive stocks.");
    }

    // trackVoice removed to prevent circular dependency
}
