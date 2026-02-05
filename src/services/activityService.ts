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
                    liquidLuckUntil: true,
                    balance: true,
                    stock: { select: { id: true, currentPrice: true, volatility: true } },
                    portfolio: { select: { shares: true, stock: { select: { id: true, currentPrice: true } } } }
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mutableUsers: any[] = [...existingUsers];
            const existingKeySet = new Set(existingUsers.map(u => `${u.discordId}:${u.guildId}`));
            const missingKeys = allKeys.filter(k => !existingKeySet.has(k));

            // 4. Handle New Users
            if (missingKeys.length > 0) {
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
                                volatility: 0.1,
                                totalShares: 1000
                            }))
                        })
                    ]);

                    const finalNewUsers = newUsersData.map(u => ({
                        id: u.id,
                        discordId: u.discordId,
                        guildId: u.guildId,
                        bullhornUntil: null,
                        liquidLuckUntil: null,
                        username: u.username,
                        balance: new Decimal(u.balance),
                        stock: {
                            id: u.stockId,
                            currentPrice: new Decimal(10.00),
                            volatility: new Decimal(0.1)
                        },
                        portfolio: []
                    }));

                    mutableUsers.push(...finalNewUsers);
                } catch (e) {
                    console.error("New user creation failed during flush", e);
                }
            }

            // 5. Calculation Logic
            const userMap = new Map();
            mutableUsers.forEach(u => userMap.set(`${u.discordId}:${u.guildId}`, u));

            for (const log of rawLogs) {
                const key = `${log.discordId}:${log.guildId}`;
                const user = userMap.get(key);
                if (!user) continue;

                let points = 0;
                // --- TUNING UPDATES ---
                if (log.type === 'MESSAGE') {
                    // Previous: min(val, 100) / 10 -> Max 10 pts
                    // New: min(val, 200) / 2 -> Max 100 pts
                    points = Math.min(log.value, 200) / 2;
                }
                else if (log.type === 'VOICE_MINUTE') {
                    // Voice minutes are multiplied by 2 in VoiceService now
                    points = log.value;
                }
                else if (log.type === 'REACTION_RECEIVED') {
                    // Previous: 5 pts
                    // New: 20 pts
                    points = 20;
                }

                if (user.bullhornUntil && new Date(user.bullhornUntil) > new Date()) {
                    points *= 2;
                }

                userScoreMap.set(key, (userScoreMap.get(key) || 0) + points);
            }

            const updatesMap = new Map<string, string>();
            const netWorthUpdates: { userId: string, netWorth: any }[] = [];

            for (const user of mutableUsers) {
                const key = `${user.discordId}:${user.guildId}`;
                const score = userScoreMap.get(key);
                if (!score || !user.stock) continue;

                const currentPrice = new Decimal(String(user.stock.currentPrice));

                let baseVol = new Decimal(String(user.stock.volatility)).toNumber();
                const priceVal = currentPrice.toNumber();

                if (priceVal > 100) {
                    baseVol = 0.1 / Math.log10(priceVal);
                }

                if (baseVol < 0.01) baseVol = 0.01;
                if (baseVol > 0.15) baseVol = 0.15;

                // LIQUID LUCK LOGIC
                if (user.liquidLuckUntil && new Date(user.liquidLuckUntil) > new Date()) {
                    baseVol = 0.15;
                }

                const volatility = new Decimal(baseVol);

                const scoreLog = new Decimal(Math.log10(score + 1));

                const DAMPENING_FACTOR = 0.25;

                let change = currentPrice.times(volatility).times(scoreLog).times(DAMPENING_FACTOR);

                if (score > 0 && change.lessThan(0.01)) {
                    change = new Decimal(0.01);
                }

                let newPrice = currentPrice.plus(change);

                if (newPrice.gt(currentPrice.times(2.0))) newPrice = currentPrice.times(2.0);

                if (newPrice.lessThan(1.00)) newPrice = new Decimal(1.00);

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
                const updateValues = Array.from(updatesMap.entries()).map(([id, price]) =>
                    Prisma.sql`(${id}::text, ${price}::decimal)`
                );

                await prisma.$executeRaw`
                        UPDATE "Stock" as s
                        SET "currentPrice" = v.price, "updatedAt" = NOW()
                        FROM (VALUES ${Prisma.join(updateValues)}) as v(id, price)
                        WHERE s.id = v.id
                    `;

                if (netWorthUpdates.length > 0) {
                    const nwValues = netWorthUpdates.map(u => Prisma.sql`(${u.userId}::text, ${u.netWorth.toFixed(2)}::decimal)`);
                    await prisma.$executeRaw`
                        UPDATE "User" as u
                        SET "netWorth" = v.nw, 
                            "updatedAt" = NOW(), 
                            "lastActiveAt" = NOW()
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
            console.error("CRITICAL FLUSH ERROR:", error);
            if (rawItems.length > 0) {
                await redisQueue.lpush(this.BUFFER_KEY, ...rawItems);
            }
        } finally {
            this.IS_FLUSHING = false;
            const len = await redisQueue.llen(this.BUFFER_KEY);
            if (len > 0) {
                setTimeout(() => {
                    this.flushActivities().catch(console.error);
                }, 100);
            }
        }
    }
}