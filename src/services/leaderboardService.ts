import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { redisCache } from '../redis';
import Decimal from 'decimal.js';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class LeaderboardService {
    private static LEADERBOARD_KEY_PREFIX = 'leaderboard:networth';

    static async updateUser(userId: string, guildId: string) {
        // Fetch full data to calculate accurate Net Worth on demand (e.g. after buy/sell)
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                balance: true,
                portfolio: {
                    select: {
                        shares: true,
                        stock: { select: { currentPrice: true } }
                    }
                }
            }
        });

        if (!user) return;

        let stockValue = new Decimal(0);
        for (const item of user.portfolio) {
            stockValue = stockValue.plus(new Decimal(item.shares).times(new Decimal(String(item.stock.currentPrice))));
        }

        const netWorth = new Decimal(String(user.balance)).plus(stockValue);

        // [NEW] Persist to DB
        await prisma.user.update({
            where: { id: userId },
            data: { netWorth: netWorth.toString() }
        });

        const key = `${this.LEADERBOARD_KEY_PREFIX}:${guildId}`;
        await redisCache.zadd(key, netWorth.toNumber(), user.id);

        await redisCache.set(`user:${user.id}:username`, user.username, 'EX', 86400);
    }

    static async syncLeaderboard() {
        console.log('Starting Optimized Leaderboard Sync...');

        const BATCH_SIZE = 1000; // Increased batch size since query is lighter
        let cursor: string | undefined = undefined;

        const ONE_HOUR = 60 * 60 * 1000;
        const activeSince = new Date(Date.now() - ONE_HOUR);

        while (true) {
            // Fetch only pre-calculated netWorth for active users
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const users: any[] = await prisma.user.findMany({
                where: { updatedAt: { gte: activeSince } },
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                select: { id: true, guildId: true, username: true, netWorth: true },
                orderBy: { id: 'asc' }
            });

            if (users.length === 0) break;

            const pipeline = redisCache.pipeline();

            for (const user of users) {
                const key = `${this.LEADERBOARD_KEY_PREFIX}:${user.guildId}`;
                // Use stored netWorth
                pipeline.zadd(key, Number(user.netWorth), user.id);
                pipeline.set(`user:${user.id}:username`, user.username, 'EX', 86400);
            }

            await pipeline.exec();

            if (users.length < BATCH_SIZE) break;
            cursor = users[users.length - 1].id;
        }

        console.log('Leaderboard Sync Complete.');
    }

    static async getLeaderboard(guildId: string, top: number = 10) {
        const key = `${this.LEADERBOARD_KEY_PREFIX}:${guildId}`;

        const result = await redisCache.zrevrange(key, 0, top - 1, 'WITHSCORES');

        const leaderboard = [];
        for (let i = 0; i < result.length; i += 2) {
            const userId = result[i];
            const netWorth = parseFloat(result[i + 1]);

            let username = await redisCache.get(`user:${userId}:username`);

            if (!username) {
                const user = await prisma.user.findUnique({ where: { id: userId } });
                username = user?.username || 'Unknown';
            }

            leaderboard.push({
                rank: (i / 2) + 1,
                username,
                netWorth
            });
        }

        return leaderboard;
    }

    static async getLeaderboardResponse(guildId: string) {
        const topUsers = await this.getLeaderboard(guildId, 10);

        if (topUsers.length === 0) {
            return null;
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 SocialStocks Leaderboard')
            .setColor(Colors.Gold)
            .setDescription(topUsers.map(u => `**#${u.rank}** ${u.username} — $${u.netWorth.toFixed(2)}`).join('\n'))
            .setFooter({ text: 'Updates every 5 minutes' });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_leaderboard')
                    .setLabel(ButtonLabels.Refresh)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Refresh),
                new ButtonBuilder()
                    .setCustomId('refresh_profile')
                    .setLabel(ButtonLabels.Profile)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(Emojis.Profile),
                new ButtonBuilder()
                    .setCustomId('refresh_market')
                    .setLabel(ButtonLabels.Market)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(Emojis.Market),
                new ButtonBuilder()
                    .setCustomId('view_help')
                    .setLabel(ButtonLabels.Help)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Help)
            );

        return { embeds: [embed], components: [row] };
    }

    static async recalculateAllNetWorths() {
        console.log("🔄 Starting Full Net Worth Sync (Batched)...");

        const BATCH_SIZE = 1000;
        let cursor: string | undefined;
        let totalUpdated = 0;

        while (true) {
            // 1. Fetch a small batch of users
            const users = await prisma.user.findMany({
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    balance: true,
                    // Only fetch minimal data needed for calc
                    portfolio: {
                        select: {
                            shares: true,
                            stock: { select: { currentPrice: true } }
                        }
                    }
                }
            });

            if (users.length === 0) break;

            // 2. Calculate updates in memory (Node.js is fast at math)
            const updates = users.map(user => {
                let stockValue = new Decimal(0);
                for (const item of user.portfolio) {
                    // Determine value based on CURRENT stock prices (which might have decayed)
                    if (item.stock) {
                        const price = new Decimal(String(item.stock.currentPrice));
                        stockValue = stockValue.plus(new Decimal(item.shares).times(price));
                    }
                }
                const newNetWorth = new Decimal(String(user.balance)).plus(stockValue);

                // Prepare the raw SQL values
                return Prisma.sql`(${user.id}::text, ${newNetWorth}::decimal)`;
            });

            // 3. Perform a Bulk Update for this batch only
            if (updates.length > 0) {
                await prisma.$executeRaw`
                    UPDATE "User" as u
                    SET "netWorth" = v.nw, "updatedAt" = NOW()
                    FROM (VALUES ${Prisma.join(updates)}) as v(id, nw)
                    WHERE u.id = v.id
                `;
            }

            totalUpdated += users.length;
            cursor = users[users.length - 1].id;

            // 4. BREATHING ROOM: Pause for 100ms to allow other bot commands to run
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ Net Worth Sync Complete. Updated ${totalUpdated} users.`);
    }
}
