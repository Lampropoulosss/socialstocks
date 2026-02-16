import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { redisCache } from '../redis';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';
import { escapeMarkdown } from '../utils/markdownUtils';

export class LeaderboardService {
    private static LEADERBOARD_KEY_PREFIX = 'leaderboard:networth';
    private static PAGE_SIZE = 10;

    static async syncLeaderboard() {
        console.log('Starting Optimized Leaderboard Sync...');
        const BATCH_SIZE = 1000;
        let cursor: string | undefined = undefined;
        const ONE_HOUR = 60 * 60 * 1000;
        const activeSince = new Date(Date.now() - ONE_HOUR);

        while (true) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const users: any[] = await prisma.user.findMany({
                where: { updatedAt: { gte: activeSince }, isOptedOut: false },
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
                pipeline.zadd(key, Number(user.netWorth), user.id);
                pipeline.set(`user:${user.id}:username`, user.username, 'EX', 86400);
            }

            await pipeline.exec();

            if (users.length < BATCH_SIZE) break;
            cursor = users[users.length - 1].id;
        }
        console.log('Leaderboard Sync Complete.');
    }

    static async getLeaderboard(guildId: string, page: number = 1) {
        const key = `${this.LEADERBOARD_KEY_PREFIX}:${guildId}`;

        // Redis indices are zero-based and inclusive
        const start = (page - 1) * this.PAGE_SIZE;
        const end = start + this.PAGE_SIZE - 1;

        const [totalCount, result] = await Promise.all([
            redisCache.zcard(key),
            redisCache.zrevrange(key, start, end, 'WITHSCORES')
        ]);

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
                rank: start + (i / 2) + 1,
                username,
                netWorth
            });
        }

        return { leaderboard, totalCount };
    }

    static async getLeaderboardResponse(guildId: string, page: number = 1) {
        const { leaderboard, totalCount } = await this.getLeaderboard(guildId, page);

        const totalPages = Math.ceil(totalCount / this.PAGE_SIZE) || 1;
        const currentPage = Math.max(1, Math.min(page, totalPages));

        if (leaderboard.length === 0 && currentPage === 1) {
            return null;
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 SocialStocks Leaderboard')
            .setColor(Colors.Gold)
            .setDescription(leaderboard.map(u => `**#${u.rank}** ${escapeMarkdown(u.username)} — $${Number(u.netWorth).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join('\n'))
            .setFooter({ text: `Page ${currentPage} of ${totalPages} • Updates every 5 minutes` });

        // Navigation Row
        const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_${currentPage - 1}`)
                .setEmoji(Emojis.Previous || '⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId('leaderboard_stats')
                .setLabel(`${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`leaderboard_page_${currentPage + 1}`)
                .setEmoji(Emojis.Next || '➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );

        // Action Row
        const actionRow = new ActionRowBuilder<ButtonBuilder>()
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
                    .setCustomId('market_page_1')
                    .setLabel(ButtonLabels.Market)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(Emojis.Market),
                new ButtonBuilder()
                    .setCustomId('view_help')
                    .setLabel(ButtonLabels.Help)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Help)
            );

        return { embeds: [embed], components: [navRow, actionRow] };
    }

    static async recalculateAllNetWorths() {
        console.log("🔄 Starting Batched Net Worth Sync...");
        const start = Date.now();
        const BATCH_SIZE = 5000;
        let processedCount = 0;
        let cursor: string | undefined = undefined;

        try {
            while (true) {
                const users: { id: string }[] = await prisma.user.findMany({
                    where: { isOptedOut: false },
                    take: BATCH_SIZE,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    select: { id: true },
                    orderBy: { id: 'asc' }
                });

                if (users.length === 0) break;
                const userIds = users.map(u => u.id);

                const count = await prisma.$executeRaw`
                    UPDATE "User" u
                    SET "netWorth" = (u.balance::decimal + (
                        SELECT COALESCE(SUM(p.shares * s."currentPrice"), 0)
                        FROM "Portfolio" p
                        JOIN "Stock" s ON p."stockId" = s.id
                        WHERE p."ownerId" = u.id
                    ))::decimal,
                    "updatedAt" = NOW()
                    WHERE u.id IN (${Prisma.join(userIds)})
                `;

                processedCount += Number(count);
                cursor = users[users.length - 1].id;
                await new Promise(r => setTimeout(r, 100));
                if (users.length < BATCH_SIZE) break;
            }
            console.log(`✅ Net Worth Sync Complete. Updated ${processedCount} users in ${Date.now() - start}ms.`);
        } catch (error) {
            console.error("❌ Net Worth Sync Failed:", error);
        }
    }
}