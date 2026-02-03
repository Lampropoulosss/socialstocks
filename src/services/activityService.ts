import { redisQueue, redisCache } from '../redis';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';

export enum ActivityType {
    MESSAGE = 'MESSAGE',
    REACTION_RECEIVED = 'REACTION_RECEIVED',
    VOICE_MINUTE = 'VOICE_MINUTE'
}

export interface ActivityData {
    discordId: string;
    guildId: string;
    username: string;
    type: ActivityType;
    value: number;
    metadata?: Record<string, any>;
    createdAt?: number;
}

const ActivityDataSchema = z.object({
    discordId: z.string(),
    guildId: z.string(),
    username: z.string(),
    type: z.enum(['MESSAGE', 'REACTION_RECEIVED', 'VOICE_MINUTE']),
    value: z.number(),
    metadata: z.record(z.string(), z.any()).optional(),
    createdAt: z.number().optional()
});

export class ActivityService {
    private static BUFFER_KEY = 'activity_buffer';
    private static IS_FLUSHING = false;

    static async bufferActivity(data: ActivityData) {
        if (!data.createdAt) data.createdAt = Date.now();
        await redisQueue.rpush(this.BUFFER_KEY, JSON.stringify(data));
    }

    static async flushActivities() {
        if (this.IS_FLUSHING) return;
        this.IS_FLUSHING = true;

        try {
            const BATCH_SIZE = 2000;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await redisQueue.lpop(this.BUFFER_KEY, BATCH_SIZE);

            if (!items || (Array.isArray(items) && items.length === 0)) {
                this.IS_FLUSHING = false;
                return;
            }

            const rawItems = Array.isArray(items) ? items : [items];
            const rawLogs: ActivityData[] = [];

            for (const item of rawItems) {
                try {
                    const parsed = JSON.parse(item);
                    const validated = ActivityDataSchema.safeParse(parsed);
                    if (validated.success) {
                        // Cast the enum type explicitly to match ActivityData interface
                        const data = validated.data as ActivityData;
                        rawLogs.push(data);
                    } else {
                        console.warn("Invalid activity data in queue:", validated.error);
                    }
                } catch (e) {
                    console.error("Failed to parse activity JSON:", e);
                }
            }

            if (rawLogs.length === 0) {
                this.IS_FLUSHING = false;
                return;
            }

            const userScoreMap = new Map<string, number>();
            const userMetaMap = new Map<string, { discordId: string, guildId: string, username: string }>();

            for (const log of rawLogs) {
                const key = `${log.discordId}:${log.guildId}`;
                if (!userMetaMap.has(key) || (userMetaMap.get(key)!.username === 'Unknown' && log.username !== 'Unknown')) {
                    userMetaMap.set(key, {
                        discordId: log.discordId,
                        guildId: log.guildId,
                        username: log.username
                    });
                }
            }

            const allKeys = Array.from(userMetaMap.keys());
            const identifiers = allKeys.map(k => {
                const [discordId, guildId] = k.split(':');
                return { discordId, guildId };
            });

            // Fetch users with bullhornUntil and Portfolio (for NetWorth calc later)
            let existingUsers = await prisma.user.findMany({
                where: { OR: identifiers },
                select: {
                    id: true,
                    discordId: true,
                    guildId: true,
                    bullhornUntil: true,
                    balance: true,
                    stock: { select: { id: true, currentPrice: true, volatility: true } },
                    portfolio: { select: { shares: true, stock: { select: { currentPrice: true } } } }
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mutableUsers: any[] = [...existingUsers];

            const existingKeySet = new Set(existingUsers.map(u => `${u.discordId}:${u.guildId}`));
            const missingKeys = allKeys.filter(k => !existingKeySet.has(k));

            if (missingKeys.length > 0) {
                console.log(`Creating ${missingKeys.length} new users...`);

                const dataToCreate = missingKeys.map(k => {
                    const meta = userMetaMap.get(k)!;
                    const safeUsername = meta.username === 'Unknown' ? `User-${meta.discordId.slice(-4)}` : meta.username;
                    return {
                        discordId: meta.discordId,
                        guildId: meta.guildId,
                        username: safeUsername,
                        balance: 100.00, // Pass as number for Prisma compatibility
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                });

                const finalNewUsers = await prisma.$transaction(async (tx) => {
                    // 1. Bulk Insert Users (1 Query)
                    await tx.user.createMany({
                        data: dataToCreate,
                        skipDuplicates: true // Vital for race conditions
                    });

                    // 2. Fetch the IDs of the users we just created/already existed
                    const identifiers = missingKeys.map(k => {
                        const meta = userMetaMap.get(k)!;
                        return { discordId: meta.discordId, guildId: meta.guildId };
                    });

                    // 3. Re-fetch to populate existingUsers array
                    let newUsers = await tx.user.findMany({
                        where: { OR: identifiers },
                        select: {
                            id: true,
                            discordId: true,
                            guildId: true,
                            username: true,
                            stock: { select: { id: true } } // minimal select to check existence
                        }
                    });

                    // 4. Handle Stock Creation using createMany
                    const usersMissingStock = newUsers.filter(u => !u.stock);

                    if (usersMissingStock.length > 0) {
                        const stocksToCreate = usersMissingStock.map(u => ({
                            userId: u.id,
                            symbol: u.username.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X'),
                            currentPrice: 10.00,
                            volatility: 0.05,
                            totalShares: 1000
                        }));

                        await tx.stock.createMany({
                            data: stocksToCreate,
                            skipDuplicates: true
                        });
                    }

                    // 5. Final Re-fetch with all needed associations
                    return await tx.user.findMany({
                        where: { OR: identifiers },
                        select: {
                            id: true,
                            discordId: true,
                            guildId: true,
                            bullhornUntil: true,
                            balance: true,
                            stock: { select: { id: true, currentPrice: true, volatility: true } },
                            portfolio: { select: { shares: true, stock: { select: { currentPrice: true } } } }
                        }
                    });
                });

                mutableUsers.push(...finalNewUsers);
            }

            // Map users for fast lookup
            const userMap = new Map();
            mutableUsers.forEach(u => userMap.set(`${u.discordId}:${u.guildId}`, u));

            // Calculate Scores
            for (const log of rawLogs) {
                const key = `${log.discordId}:${log.guildId}`;
                const user = userMap.get(key);
                if (!user) continue; // Should not happen

                let points = 0;
                if (log.type === 'MESSAGE') points = Math.min(log.value, 100) / 10;
                else if (log.type === 'VOICE_MINUTE') points = log.value;
                else if (log.type === 'REACTION_RECEIVED') points = 5;

                // [NEW] Apply Bullhorn Multiplier from DB
                if (user.bullhornUntil && new Date(user.bullhornUntil) > new Date()) {
                    points *= 2;
                }

                userScoreMap.set(key, (userScoreMap.get(key) || 0) + points);
            }

            const updatesMap = new Map<string, string>();
            const leaderboardUpdates: { userId: string, guildId: string }[] = [];
            const netWorthUpdates: { userId: string, netWorth: any }[] = [];

            for (const user of mutableUsers) {
                const key = `${user.discordId}:${user.guildId}`;
                const score = userScoreMap.get(key);
                if (!score || !user.stock) continue;

                const currentPrice = new Decimal(Number(user.stock.currentPrice));
                const volatility = new Decimal(Number(user.stock.volatility));

                const scoreLog = new Decimal(Math.log10(score + 1));

                const DAMPENING_FACTOR = 0.01;
                const change = currentPrice.times(volatility).times(scoreLog).times(DAMPENING_FACTOR);

                let newPrice = currentPrice.plus(change);

                if (newPrice.gt(currentPrice.times(1.5))) newPrice = currentPrice.times(1.5);
                if (newPrice.lessThan(10.00)) newPrice = new Decimal(10.00);

                const newPriceStr = newPrice.toFixed(2);
                updatesMap.set(user.stock.id, newPriceStr);

                let stockValue = new Decimal(0);
                for (const item of user.portfolio) {
                    let price = new Decimal(String(item.stock.currentPrice));
                    if (item.stock!.id === user.stock.id) { // Own stock
                        price = newPrice;
                    } else if (updatesMap.has(item.stock!.id)) { // Updated in this batch
                        price = new Decimal(updatesMap.get(item.stock!.id)!);
                    }
                    stockValue = stockValue.plus(new Decimal(item.shares).times(price));
                }
                const netWorth = new Decimal(String(user.balance)).plus(stockValue);
                netWorthUpdates.push({ userId: user.id, netWorth: netWorth.toString() });

                leaderboardUpdates.push({ userId: user.id, guildId: user.guildId });
            }

            if (updatesMap.size > 0) {
                // Update Stocks
                const updateValues = Array.from(updatesMap.entries()).map(([id, price]) =>
                    Prisma.sql`(${id}::text, ${price}::decimal)`
                );

                await prisma.$executeRaw`
                        UPDATE "Stock" as s
                        SET "currentPrice" = v.price, "updatedAt" = NOW()
                        FROM (VALUES ${Prisma.join(updateValues)}) as v(id, price)
                        WHERE s.id = v.id
                    `;

                // [NEW] Update Net Worths
                // We can do this with another bulk update
                if (netWorthUpdates.length > 0) {
                    const nwValues = netWorthUpdates.map(u => Prisma.sql`(${u.userId}::text, ${u.netWorth.toFixed(2)}::decimal)`);
                    await prisma.$executeRaw`
                        UPDATE "User" as u
                        SET "netWorth" = v.nw, "updatedAt" = NOW()
                        FROM (VALUES ${Prisma.join(nwValues)}) as v(id, nw)
                        WHERE u.id = v.id
                     `;
                }

                const pipeline = redisCache.pipeline();
                netWorthUpdates.forEach(u => {
                    const user = mutableUsers.find(eu => eu.id === u.userId);
                    if (user) {
                        const key = `leaderboard:networth:${user.guildId}`;
                        pipeline.zadd(key, u.netWorth.toNumber(), u.userId);
                        pipeline.set(`user:${u.userId}:username`, user.username, 'EX', 86400);
                    }
                });
                await pipeline.exec();
            }

        } catch (error) {
            console.error("Flush Error:", error);
        } finally {
            this.IS_FLUSHING = false;
            const len = await redisQueue.llen(this.BUFFER_KEY);
            if (len > 0) {
                setTimeout(() => {
                    this.flushActivities().catch(e => console.error("Critical Flush Loop Error:", e));
                }, 200);
            }
        }
    }
}
