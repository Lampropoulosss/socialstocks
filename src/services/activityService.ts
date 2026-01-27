import redis from '../redis';
import prisma from '../prisma';
import { ActivityType } from '@prisma/client';
import Decimal from 'decimal.js';

export interface ActivityData {
    discordId: string;
    guildId: string;
    username: string;
    type: ActivityType;
    value: number;
    metadata?: Record<string, any>;
    createdAt?: number;
}

export class ActivityService {
    private static BUFFER_KEY = 'activity_buffer';

    static async bufferActivity(data: ActivityData) {
        if (!data.createdAt) data.createdAt = Date.now();
        await redis.rpush(this.BUFFER_KEY, JSON.stringify(data));
    }

    static async flushActivities() {
        const BATCH_SIZE = 2000;
        // @ts-ignore
        const items = await redis.lpop(this.BUFFER_KEY, BATCH_SIZE);

        if (!items || (Array.isArray(items) && items.length === 0)) return;

        const rawLogs: ActivityData[] = (Array.isArray(items) ? items : [items])
            .map(s => {
                try { return JSON.parse(s); } catch { return null; }
            })
            .filter(i => i !== null);

        if (rawLogs.length === 0) return;

        // 1. Aggregate Scores In-Memory
        const userScoreMap = new Map<string, number>();
        const uniqueKeys = new Set<string>();

        for (const log of rawLogs) {
            const key = `${log.discordId}:${log.guildId}`;
            uniqueKeys.add(key);

            let points = 0;
            if (log.type === 'MESSAGE') points = Math.min(log.value, 100) / 10;
            else if (log.type === 'VOICE_MINUTE') points = log.value;
            else if (log.type === 'REACTION_RECEIVED') points = 5;

            userScoreMap.set(key, (userScoreMap.get(key) || 0) + points);
        }

        // 2. Fetch Users & Current Stock State
        const users = await prisma.user.findMany({
            where: {
                OR: Array.from(uniqueKeys).map(k => {
                    const [d, g] = k.split(':');
                    return { discordId: d, guildId: g };
                })
            },
            select: {
                id: true, discordId: true, guildId: true,
                stock: { select: { id: true, currentPrice: true, volatility: true } }
            }
        });

        const stockUpdates: string[] = [];
        const historyInserts: { stockId: string, price: string, recordedAt: Date }[] = [];
        const leaderboardUpdates: { userId: string, guildId: string }[] = [];

        for (const user of users) {
            const key = `${user.discordId}:${user.guildId}`;
            const score = userScoreMap.get(key);

            if (!score || !user.stock) continue;

            // Calculate Price
            const currentPrice = new Decimal(Number(user.stock.currentPrice));
            const volatility = Number(user.stock.volatility);

            // Growth Logic
            let change = currentPrice.times(volatility * score * 0.01);
            let newPrice = currentPrice.plus(change);

            // Cap (Max 1.5x growth per flush)
            if (newPrice.gt(currentPrice.times(1.5))) newPrice = currentPrice.times(1.5);

            const newPriceStr = newPrice.toFixed(2);

            // A. Prepare Stock Update
            stockUpdates.push(`('${user.stock.id}', ${newPriceStr})`);

            // B. Prepare History Entry (CRITICAL FIX)
            historyInserts.push({
                stockId: user.stock.id,
                price: newPriceStr,
                recordedAt: new Date()
            });

            // C. Prepare Leaderboard Update
            leaderboardUpdates.push({ userId: user.id, guildId: user.guildId });
        }

        // 3. Execute Database Writes
        if (stockUpdates.length > 0) {
            // Bulk Update Stock Prices
            await prisma.$executeRawUnsafe(`
                UPDATE "Stock" as s
                SET "currentPrice" = v.price::decimal, "updatedAt" = NOW()
                FROM (VALUES ${stockUpdates.join(',')}) as v(id, price)
                WHERE s.id = v.id::uuid
            `);

            // Bulk Insert History (Fixes missing graphs)
            await prisma.stockHistory.createMany({
                data: historyInserts
            });

            console.log(`Processed ${rawLogs.length} logs. Updated ${stockUpdates.length} stocks.`);

            // Trigger Leaderboard (Non-blocking)
            if (leaderboardUpdates.length > 0) {
                const { LeaderboardService } = require('./leaderboardService');
                leaderboardUpdates.forEach(u => {
                    LeaderboardService.updateUser(u.userId, u.guildId).catch(console.error);
                });
            }
        }

        // Recurse if buffer is full
        if (items.length === BATCH_SIZE) {
            setImmediate(() => this.flushActivities());
        }
    }
}
