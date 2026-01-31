import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import Decimal from 'decimal.js';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class LeaderboardService {
    private static LEADERBOARD_KEY_PREFIX = 'leaderboard:networth';

    static async updateUser(userId: string, guildId: string) {
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
        const key = `${this.LEADERBOARD_KEY_PREFIX}:${guildId}`;

        await redisCache.zadd(key, netWorth.toNumber(), user.id);

        await redisCache.set(`user:${user.id}:username`, user.username, 'EX', 86400);
    }

    static async syncLeaderboard() {
        console.log('Starting Leaderboard Sync...');

        const BATCH_SIZE = 100;
        let cursor: string | undefined = undefined;

        while (true) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const batchUsers: any[] = await prisma.user.findMany({
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                select: { id: true, guildId: true },
                orderBy: { id: 'asc' }
            });

            if (batchUsers.length === 0) break;

            const usersWithData = await prisma.user.findMany({
                where: { id: { in: batchUsers.map(u => u.id) } },
                select: {
                    id: true,
                    guildId: true,
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

            const pipeline = redisCache.pipeline();

            for (const user of usersWithData) {
                const key = `${this.LEADERBOARD_KEY_PREFIX}:${user.guildId}`;
                let stockValue = new Decimal(0);
                for (const item of user.portfolio) {
                    stockValue = stockValue.plus(new Decimal(item.shares).times(new Decimal(String(item.stock.currentPrice))));
                }
                const netWorth = new Decimal(String(user.balance)).plus(stockValue);

                pipeline.zadd(key, netWorth.toNumber(), user.id);
                pipeline.set(`user:${user.id}:username`, user.username, 'EX', 86400);
            }

            await pipeline.exec();

            if (batchUsers.length < BATCH_SIZE) break;
            cursor = batchUsers[batchUsers.length - 1].id;
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
}
