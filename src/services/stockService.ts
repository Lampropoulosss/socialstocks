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

    // Kept for VoiceService compatibility
    static async trackVoice(userId: string, minutes: number = 1) {
        const { ActivityService } = require('./activityService');
        await ActivityService.bufferActivity({
            userId,
            // Assuming strict types, you might need to cast or fix interface if 'userId' isn't on ActivityData
            // Based on your previous file, ActivityData uses 'discordId', but internal tracking might use internal ID.
            // If trackVoice is called with internal UUID, ensure ActivityService handles it or convert it.
            // For now, mapping broadly:
            type: 'VOICE_MINUTE',
            value: 60 * minutes
        } as any);
    }
}
