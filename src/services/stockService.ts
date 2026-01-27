import { ActivityType, Prisma } from '@prisma/client';
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

        const BATCH_SIZE = 50; // Process 50 users at a time to avoid memory overload
        let skip = 0;
        let processedUsers = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            // 1. Fetch Batch of Stocks
            const stocks = await prisma.stock.findMany({
                include: {
                    user: { select: { guildId: true } }
                },
                take: BATCH_SIZE,
                skip: skip,
                orderBy: { id: 'asc' } // Ensure stable ordering for pagination
            });

            if (stocks.length === 0) break;

            const userIds = stocks.map(s => s.userId);

            // 2. Fetch Activities for ONLY these users
            const activities = await prisma.activityLog.findMany({
                where: {
                    userId: { in: userIds },
                    processed: false
                }
            });

            // 3. Group Activities by User
            const activitiesByUser = new Map<string, typeof activities>();
            activities.forEach(log => {
                const logs = activitiesByUser.get(log.userId) || [];
                logs.push(log);
                activitiesByUser.set(log.userId, logs);
            });

            // Prepare Data containers
            const updatesToRun: { id: string, price: string }[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const historyCreates: any[] = [];
            const logIdsToDelete: string[] = [];
            const leaderboardUpdates: { userId: string, guildId: string }[] = [];

            // 4. Process Each Stock (In-Memory)
            for (const stock of stocks) {
                const userLogs = activitiesByUser.get(stock.userId) || [];

                // Calculate Score
                let score = 0;
                const recentMessages = new Set<string>();

                for (const log of userLogs) {
                    logIdsToDelete.push(log.id);

                    if (log.type === 'MESSAGE') {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const content = (log.metadata as any)?.contentHash || "";
                        if (recentMessages.has(content)) continue;
                        recentMessages.add(content);

                        const points = Math.min(log.value, 100) / 10;
                        score += points;
                    } else if (log.type === ActivityType.VOICE_MINUTE) {
                        score += 2;
                    } else if (log.type === ActivityType.REACTION_RECEIVED) {
                        score += 5;
                    }
                }

                // Calculate New Price
                const currentPrice = new Decimal(String(stock.currentPrice));
                let newPrice;

                if (score === 0) {
                    // Decay
                    newPrice = currentPrice.times(1 - this.DECAY_RATE);
                    const minPrice = new Decimal(0.1);
                    if (newPrice.lessThan(minPrice)) newPrice = minPrice;
                } else {
                    // Growth
                    const change = new Decimal(score).times(String(stock.volatility));
                    newPrice = currentPrice.plus(change);

                    const maxGrowth = currentPrice.times(1.5);
                    if (newPrice.greaterThan(maxGrowth)) newPrice = maxGrowth;
                }

                const newPriceStr = newPrice.toString();

                // Queue Updates
                if (newPriceStr !== stock.currentPrice.toString()) {
                    updatesToRun.push({ id: stock.id, price: newPriceStr });

                    historyCreates.push({
                        stockId: stock.id,
                        price: newPriceStr
                    });

                    leaderboardUpdates.push({ userId: stock.userId, guildId: stock.user.guildId });
                }
            }

            // 5. Execute Batch Updates for this Page

            // A. Optimization 2: True Bulk Updates (Raw SQL)
            if (updatesToRun.length > 0) {
                const CHUNK_SIZE = 1000;
                for (let i = 0; i < updatesToRun.length; i += CHUNK_SIZE) {
                    const chunk = updatesToRun.slice(i, i + CHUNK_SIZE);

                    // Generate (id, price) tuples
                    const values = chunk.map(u => `('${u.id}', ${u.price}::decimal)`).join(',');

                    const query = Prisma.sql`
                        UPDATE "Stock" as s
                        SET "currentPrice" = v.price
                        FROM (VALUES ${Prisma.raw(values)}) as v(id, price)
                        WHERE s.id = v.id::text
                    `;

                    await prisma.$executeRaw(query);
                }
            }

            // B. Delete Processed Logs
            if (logIdsToDelete.length > 0) {
                await prisma.activityLog.deleteMany({
                    where: { id: { in: logIdsToDelete } }
                });
            }

            // C. Create History
            if (historyCreates.length > 0) {
                await prisma.stockHistory.createMany({
                    data: historyCreates
                });
            }

            // D. Leaderboard Updates
            if (leaderboardUpdates.length > 0) {
                const { LeaderboardService } = require('./leaderboardService');
                for (const update of leaderboardUpdates) {
                    LeaderboardService.updateUser(update.userId, update.guildId).catch(console.error);
                }
            }

            processedUsers += stocks.length;
            skip += BATCH_SIZE;
        }

        console.log(`Finished batch update. Processed ${processedUsers} users.`);
    }

    static async trackVoice(userId: string, minutes: number = 1) {
        const { ActivityService } = require('./activityService');
        await ActivityService.bufferActivity({
            userId,
            type: ActivityType.VOICE_MINUTE,
            value: 60 * minutes
        });
    }
}
