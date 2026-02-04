import { redisQueue, redisCache } from '../redis';
import { randomUUID } from 'crypto';
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

        // Keep a reference to raw items for recovery
        let rawItems: string[] = [];

        try {
            const BATCH_SIZE = 2000;
            const items = await redisQueue.lpop(this.BUFFER_KEY, BATCH_SIZE);

            if (!items || (Array.isArray(items) && items.length === 0)) {
                this.IS_FLUSHING = false;
                return;
            }

            rawItems = Array.isArray(items) ? items : [items];
            const rawLogs: ActivityData[] = [];

            // 1. Parse & Validate
            for (const item of rawItems) {
                try {
                    const parsed = JSON.parse(item);
                    const validated = ActivityDataSchema.safeParse(parsed);
                    if (validated.success) {
                        rawLogs.push(validated.data as ActivityData);
                    } else {
                        console.warn("Invalid activity data dropped:", validated.error);
                    }
                } catch (e) {
                    console.error("JSON Parse error:", e);
                }
            }

            if (rawLogs.length === 0) {
                this.IS_FLUSHING = false;
                return;
            }

            // 2. Group by User
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

            // 3. Fetch Existing Users
            const existingUsers = await prisma.user.findMany({
                where: { OR: identifiers },
                select: {
                    id: true,
                    discordId: true,
                    guildId: true,
                    bullhornUntil: true,
                    balance: true,
                    stock: { select: { id: true, currentPrice: true, volatility: true } },
                    portfolio: { select: { shares: true, stock: { select: { id: true, currentPrice: true } } } }
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mutableUsers: any[] = [...existingUsers];

            const existingKeySet = new Set(existingUsers.map(u => `${u.discordId}:${u.guildId}`));
            const missingKeys = allKeys.filter(k => !existingKeySet.has(k));

            // 4. Handle New Users (Optimistic Path)
            if (missingKeys.length > 0) {
                console.log(`Creating ${missingKeys.length} new users...`);

                const newUsersData = missingKeys.map(k => {
                    const meta = userMetaMap.get(k)!;
                    const safeUsername = meta.username === 'Unknown' ? `User-${meta.discordId.slice(-4)}` : meta.username;
                    return {
                        id: randomUUID(),
                        discordId: meta.discordId,
                        guildId: meta.guildId,
                        username: safeUsername,
                        balance: 100.00,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        stockId: randomUUID(),
                        stockSymbol: safeUsername.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X')
                    };
                });

                try {
                    // OPTIMISTIC WRITE
                    await prisma.$transaction([
                        prisma.user.createMany({
                            data: newUsersData.map(u => ({
                                id: u.id,
                                discordId: u.discordId,
                                guildId: u.guildId,
                                username: u.username,
                                balance: u.balance,
                                createdAt: u.createdAt,
                                updatedAt: u.updatedAt
                            }))
                        }),
                        prisma.stock.createMany({
                            data: newUsersData.map(u => ({
                                id: u.stockId,
                                userId: u.id,
                                symbol: u.stockSymbol,
                                currentPrice: 10.00,
                                volatility: 0.05,
                                totalShares: 1000
                            }))
                        })
                    ]);

                    // Add to mutable list using In-Memory construction (No DB fetch needed)
                    const finalNewUsers = newUsersData.map(u => ({
                        id: u.id,
                        discordId: u.discordId,
                        guildId: u.guildId,
                        bullhornUntil: null,
                        username: u.username,
                        balance: new Decimal(u.balance),
                        stock: {
                            id: u.stockId,
                            currentPrice: new Decimal(10.00),
                            volatility: new Decimal(0.05)
                        },
                        portfolio: []
                    }));

                    mutableUsers.push(...finalNewUsers);
                } catch (e) {
                    console.warn(`Optimized creation race condition, triggering fallback.`);

                    // FALLBACK WRITE (Slower, Safer)
                    const fallbackUsers = await prisma.$transaction(async (tx) => {
                        await tx.user.createMany({
                            data: newUsersData.map(u => ({
                                id: u.id,
                                discordId: u.discordId,
                                guildId: u.guildId,
                                username: u.username,
                                balance: u.balance,
                                createdAt: u.createdAt,
                                updatedAt: u.updatedAt
                            })),
                            skipDuplicates: true
                        });

                        const idsToFetch = missingKeys.map(k => {
                            const meta = userMetaMap.get(k)!;
                            return { discordId: meta.discordId, guildId: meta.guildId };
                        });

                        const usersWithStocks = await tx.user.findMany({
                            where: { OR: idsToFetch },
                            select: { id: true, username: true, stock: { select: { id: true } } }
                        });

                        const usersMissingStock = usersWithStocks.filter(u => !u.stock);

                        if (usersMissingStock.length > 0) {
                            await tx.stock.createMany({
                                data: usersMissingStock.map(u => ({
                                    userId: u.id,
                                    symbol: u.username.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X'),
                                    currentPrice: 10.00,
                                    volatility: 0.05,
                                    totalShares: 1000
                                })),
                                skipDuplicates: true
                            });
                        }

                        // Final Fetch for Calculation
                        return await tx.user.findMany({
                            where: { OR: idsToFetch },
                            select: {
                                id: true,
                                discordId: true,
                                guildId: true,
                                username: true,
                                bullhornUntil: true,
                                balance: true,
                                stock: { select: { id: true, currentPrice: true, volatility: true } },
                                portfolio: { select: { shares: true, stock: { select: { id: true, currentPrice: true } } } }
                            }
                        });
                    });

                    mutableUsers.push(...fallbackUsers);
                }
            }

            // 5. Calculation Logic
            // Map users for fast lookup
            const userMap = new Map();
            mutableUsers.forEach(u => userMap.set(`${u.discordId}:${u.guildId}`, u));

            // Aggregate Scores
            for (const log of rawLogs) {
                const key = `${log.discordId}:${log.guildId}`;
                const user = userMap.get(key);
                if (!user) continue;

                let points = 0;
                if (log.type === 'MESSAGE') points = Math.min(log.value, 100) / 10;
                else if (log.type === 'VOICE_MINUTE') points = log.value;
                else if (log.type === 'REACTION_RECEIVED') points = 5;

                if (user.bullhornUntil && new Date(user.bullhornUntil) > new Date()) {
                    points *= 2;
                }

                userScoreMap.set(key, (userScoreMap.get(key) || 0) + points);
            }

            const updatesMap = new Map<string, string>(); // StockId -> Price
            const netWorthUpdates: { userId: string, netWorth: any }[] = [];

            for (const user of mutableUsers) {
                const key = `${user.discordId}:${user.guildId}`;
                const score = userScoreMap.get(key);
                if (!score || !user.stock) continue;

                const currentPrice = new Decimal(String(user.stock.currentPrice));
                const volatility = new Decimal(String(user.stock.volatility));

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
                    if (item.stock.id === user.stock.id) {
                        price = newPrice;
                    } else if (updatesMap.has(item.stock.id)) {
                        price = new Decimal(updatesMap.get(item.stock.id)!);
                    }
                    stockValue = stockValue.plus(new Decimal(item.shares).times(price));
                }

                const netWorth = new Decimal(String(user.balance)).plus(stockValue);
                netWorthUpdates.push({ userId: user.id, netWorth });
            }

            if (updatesMap.size > 0) {
                // Bulk Update Stock Prices
                const updateValues = Array.from(updatesMap.entries()).map(([id, price]) =>
                    Prisma.sql`(${id}::text, ${price}::decimal)`
                );

                await prisma.$executeRaw`
                        UPDATE "Stock" as s
                        SET "currentPrice" = v.price, "updatedAt" = NOW()
                        FROM (VALUES ${Prisma.join(updateValues)}) as v(id, price)
                        WHERE s.id = v.id
                    `;

                // Bulk Update Net Worths
                if (netWorthUpdates.length > 0) {
                    const nwValues = netWorthUpdates.map(u => Prisma.sql`(${u.userId}::text, ${u.netWorth.toFixed(2)}::decimal)`);
                    await prisma.$executeRaw`
                        UPDATE "User" as u
                        SET "netWorth" = v.nw, "updatedAt" = NOW()
                        FROM (VALUES ${Prisma.join(nwValues)}) as v(id, nw)
                        WHERE u.id = v.id
                     `;
                }

                // Update Redis Leaderboard
                const pipeline = redisCache.pipeline();
                netWorthUpdates.forEach(u => {
                    const user = mutableUsers.find(eu => eu.id === u.userId);
                    if (user) {
                        const key = `leaderboard:networth:${user.guildId}`;
                        // ZADD requires number, so we cast the Decimal
                        pipeline.zadd(key, u.netWorth.toNumber(), u.userId);
                        pipeline.set(`user:${u.userId}:username`, user.username, 'EX', 86400);
                    }
                });
                await pipeline.exec();
            }

        } catch (error) {
            console.error("CRITICAL FLUSH ERROR:", error);

            if (rawItems.length > 0) {
                console.log(`Recovering ${rawItems.length} items to queue...`);
                await redisQueue.lpush(this.BUFFER_KEY, ...rawItems);
            }

        } finally {
            this.IS_FLUSHING = false;

            // Check if queue still has items and loop immediately if so
            const len = await redisQueue.llen(this.BUFFER_KEY);
            if (len > 0) {
                setTimeout(() => {
                    this.flushActivities().catch(e => console.error("Flush Loop Error:", e));
                }, 100);
            }
        }
    }
}
