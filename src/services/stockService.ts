import { ActivityType } from '@prisma/client';
import prisma from '../prisma';
import Decimal from 'decimal.js';

export class StockService {
    // Constants
    private static BASE_PRICE = 10.0;
    private static PRICE_VOLATILITY_FACTOR = 0.1; // How much activity influences price
    private static DECAY_RATE = 0.05; // Price drop per period of inactivity

    /**
     * Updates the price of a user's stock based on recent activity.
     */
    static async updateStockPrice(userId: string) {
        const stock = await prisma.stock.findUnique({
            where: { userId },
            include: {
                history: { orderBy: { recordedAt: 'desc' }, take: 1 },
                user: { select: { guildId: true } }
            }
        });

        if (!stock) return;

        // Fetch unprocessed activities
        const activities = await prisma.activityLog.findMany({
            where: {
                userId,
                processed: false
            }
        });

        // Use a transaction to ensure we only count them if we mark them as processed
        await prisma.$transaction(async (tx) => {
            // Calculate Activity Score
            let score = 0;
            const recentMessages = new Set<string>();
            const logIdsToMark: string[] = [];

            for (const log of activities) {
                logIdsToMark.push(log.id);

                if (log.type === 'MESSAGE') {
                    // Anti-Spam: Check duplicate content
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const content = (log.metadata as any)?.contentHash || "";
                    if (recentMessages.has(content)) {
                        continue; // Skip duplicate message
                    }
                    recentMessages.add(content);

                    // Value based on length, capped
                    const points = Math.min(log.value, 100) / 10;
                    score += points;
                } else if (log.type === ActivityType.VOICE_MINUTE) {
                    score += 2; // 2 points per minute of voice
                } else if (log.type === ActivityType.REACTION_RECEIVED) {
                    score += 5; // High value for being funny/helpful
                }
            }

            // Cleanup: DELETE logs instead of just marking processed
            if (logIdsToMark.length > 0) {
                await tx.activityLog.deleteMany({
                    where: { id: { in: logIdsToMark } },
                    // data: { processed: true } // OLD WAY
                });
            }

            // Apply decay if inactive (score 0 and no unprocessed logs)
            const currentPrice = new Decimal(String(stock.currentPrice));
            let newPrice;

            if (score === 0) {
                // Decay
                newPrice = currentPrice.times(1 - this.DECAY_RATE);
                const minPrice = new Decimal(0.1);
                if (newPrice.lessThan(minPrice)) {
                    newPrice = minPrice;
                }

                // Optimization: Don't write DB if price hasn't changed (rounded)
                if (newPrice.equals(currentPrice)) return;
            } else {
                // Growth
                const change = new Decimal(score).times(String(stock.volatility));
                newPrice = currentPrice.plus(change);

                // Cap max growth per update (1.5x)
                const maxGrowth = currentPrice.times(1.5);
                if (newPrice.greaterThan(maxGrowth)) {
                    newPrice = maxGrowth;
                }
            }

            // Update DB
            await tx.stock.update({
                where: { id: stock.id },
                data: { currentPrice: newPrice.toString() }
            });

            await tx.stockHistory.create({
                data: {
                    stockId: stock.id,
                    price: newPrice.toString()
                }
            });
        });

        // Trigger Leaderboard Update (Event Driven)
        // We do this outside the transaction to not block it, 
        // as leaderboard update involves Redis and potentially other DB reads.
        try {
            // Need LeaderboardService import. 
            // Circular dependency might be an issue if direct import?
            // Services usually fine.
            const { LeaderboardService } = require('./leaderboardService');
            await LeaderboardService.updateUser(userId, stock.user.guildId);
        } catch (e) {
            console.error(`Failed to update leaderboard for ${userId}`, e);
        }
    }

    static async updateAllStocks() {
        console.log("Starting batch stock price update...");
        // Get all users who have a stock
        const stocks = await prisma.stock.findMany({
            select: { userId: true }
        });

        const BATCH_SIZE = 20;
        const chunk = <T>(arr: T[], size: number): T[][] =>
            Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
                arr.slice(i * size, i * size + size)
            );

        const batches = chunk(stocks, BATCH_SIZE);

        for (const batch of batches) {
            await Promise.all(batch.map(async (s) => {
                try {
                    await this.updateStockPrice(s.userId);
                } catch (err) {
                    console.error(`Failed to update stock for user ${s.userId}:`, err);
                }
            }));
        }

        console.log(`Updated ${stocks.length} stocks.`);
    }

    static async trackVoice(userId: string, minutes: number = 1) {
        await prisma.activityLog.create({
            data: {
                userId,
                type: ActivityType.VOICE_MINUTE,
                value: 60 * minutes,
                processed: false // Explicitly default
            }
        });
    }
}
