import { redisQueue, redisCache } from '../redis';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { LeaderboardService } from './leaderboardService';

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
            // @ts-ignore
            const items = await redisQueue.lpop(this.BUFFER_KEY, BATCH_SIZE);

            if (!items || (Array.isArray(items) && items.length === 0)) {
                this.IS_FLUSHING = false;
                return;
            }

            const rawLogs: ActivityData[] = (Array.isArray(items) ? items : [items])
                .map(s => { try { return JSON.parse(s); } catch { return null; } })
                .filter(i => i !== null);

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

            // [NEW] No pre-fetching Redis buffs. handled in DB query or logic below?
            // Actually we need to check if user has buff to multiply points.
            // We can fetch this when we fetch the users from DB.
            // But we calculate points BEFORE fetching users from DB in the original code? 
            // Original: 1. Calc points (with Redis buff check). 2. Fetch/Create DB users. 3. Apply changes.
            // If we move buff check to DB, we must fetch users FIRST or fetch buffs FIRST.
            // Optimally, fetch users first to get `bullhornUntil`?
            // But if user doesn't exist, we create them. They won't have buff.

            // Re-ordering approach:
            // 1. Identify users (discordId:guildId)
            // 2. Fetch existing users (with bullhornUntil)
            // 3. For missing users -> create them (no buff)
            // 4. Calculate points using fetched/created data
            // 5. Update Stock Prices

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

                // 1. Bulk Insert Users (1 Query)
                await prisma.user.createMany({
                    data: dataToCreate,
                    skipDuplicates: true // Vital for race conditions
                });

                // 2. Fetch the IDs of the users we just created/already existed
                const identifiers = missingKeys.map(k => {
                    const meta = userMetaMap.get(k)!;
                    return { discordId: meta.discordId, guildId: meta.guildId };
                });

                // 3. Re-fetch to populate existingUsers array
                let newUsers = await prisma.user.findMany({
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

                    await prisma.stock.createMany({
                        data: stocksToCreate,
                        skipDuplicates: true
                    });
                }

                // 5. Final Re-fetch with all needed associations
                const finalNewUsers = await prisma.user.findMany({
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
                const volatility = Number(user.stock.volatility);

                let change = currentPrice.times(volatility * Math.log10(score + 1) * 100 * 0.01);
                let newPrice = currentPrice.plus(change);

                if (newPrice.gt(currentPrice.times(1.5))) newPrice = currentPrice.times(1.5);
                if (newPrice.lessThan(10.00)) newPrice = new Decimal(10.00);

                const newPriceStr = newPrice.toFixed(2);
                updatesMap.set(user.stock.id, newPriceStr);

                // [NEW] Recalculate Net Worth for this user (Lazy consistency)
                // NetWorth = Balance + Sum(Shares * Price)
                // Note: user.portfolio contains stocks. The price of THIS user's stock just changed.
                // If the user holds their OWN stock, we must use the NEW PRICE.
                // If they hold others, we use the CURRENT price from the DB (which might be stale if others updated in this batch, ignoring that complexity for now).
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

                // Push to Redis Leaderboard
                // LeaderboardService.updateUser is single user update.
                // We could optimize ensuring we don't spam redis if we just updated DB.
                // LeaderboardService.updateUser re-calculates netWorth from DB. 
                // Since we just calculated it, we could push directly?
                // But `updateUser` fetches fresh data.
                // Let's just let LeaderboardService handle it for now, or use `syncLeaderboard` logic?
                // `LeaderboardService.updateUser` calls `prisma.user.update`. We already updated netWorth.
                // So `LeaderboardService.updateUser` will fetch the updated netWorth and push to Redis.
                // But it RE-CALCULATES it in `updateUser` (unless we updated it to strictly read?).
                // I updated `updateUser` to re-calculate and Persist.
                // If I run `updateUser` now, it will fetch the just-updated DB, re-calc (same result), update DB (redundant), push to Redis.
                // It's a bit redundant but safe.
                // To optimize, I should just push to Redis here.

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
            if (len > 0) setImmediate(() => this.flushActivities());
        }
    }
}
