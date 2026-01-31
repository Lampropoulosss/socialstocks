import { redisQueue } from '../redis';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

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

                let points = 0;
                if (log.type === 'MESSAGE') points = Math.min(log.value, 100) / 10;
                else if (log.type === 'VOICE_MINUTE') points = log.value;
                else if (log.type === 'REACTION_RECEIVED') points = 5;

                userScoreMap.set(key, (userScoreMap.get(key) || 0) + points);
            }

            const allKeys = Array.from(userMetaMap.keys());
            const identifiers = allKeys.map(k => {
                const [discordId, guildId] = k.split(':');
                return { discordId, guildId };
            });

            let existingUsers = await prisma.user.findMany({
                where: { OR: identifiers },
                select: { id: true, discordId: true, guildId: true, stock: { select: { id: true, currentPrice: true, volatility: true } } }
            });

            const existingKeySet = new Set(existingUsers.map(u => `${u.discordId}:${u.guildId}`));
            const missingKeys = allKeys.filter(k => !existingKeySet.has(k));

            if (missingKeys.length > 0) {
                console.log(`Creating ${missingKeys.length} new users...`);

                try {
                    await prisma.$transaction(async (tx) => {
                        for (const k of missingKeys) {
                            const meta = userMetaMap.get(k)!;
                            const safeUsername = meta.username === 'Unknown' ? `User-${meta.discordId.slice(-4)}` : meta.username;

                            const newUser = await tx.user.create({
                                data: {
                                    discordId: meta.discordId,
                                    guildId: meta.guildId,
                                    username: safeUsername,
                                }
                            });

                            const newStock = await tx.stock.create({
                                data: {
                                    userId: newUser.id,
                                    symbol: safeUsername.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X'),
                                    currentPrice: 10.00,
                                    volatility: 0.05,
                                    totalShares: 1000
                                }
                            });
                        }
                    });
                } catch (e: any) {
                    if (e.code === 'P2002') {
                        console.warn("Race condition detected during user creation (Unique Constraint). Skipping creation step.");
                    } else {
                        console.error("Error creating users:", e);
                    }
                }

                existingUsers = await prisma.user.findMany({
                    where: { OR: identifiers },
                    select: { id: true, discordId: true, guildId: true, stock: { select: { id: true, currentPrice: true, volatility: true } } }
                });
            }

            const leaderboardUpdates: { userId: string, guildId: string }[] = [];

            const updatesMap = new Map<string, string>();

            for (const user of existingUsers) {
                const key = `${user.discordId}:${user.guildId}`;
                const score = userScoreMap.get(key);
                if (!score || !user.stock) continue;

                const currentPrice = new Decimal(Number(user.stock.currentPrice));
                const volatility = Number(user.stock.volatility);

                let change = currentPrice.times(volatility * score * 0.01);
                let newPrice = currentPrice.plus(change);

                if (newPrice.gt(currentPrice.times(1.5))) newPrice = currentPrice.times(1.5);

                if (newPrice.lessThan(10.00)) {
                    newPrice = new Decimal(10.00);
                }
                const newPriceStr = newPrice.toFixed(2);

                updatesMap.set(user.stock.id, newPriceStr);



                leaderboardUpdates.push({ userId: user.id, guildId: user.guildId });
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

                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { LeaderboardService } = require('./leaderboardService');
                leaderboardUpdates.forEach(u => LeaderboardService.updateUser(u.userId, u.guildId).catch(console.error));
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
