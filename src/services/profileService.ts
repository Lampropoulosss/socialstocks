import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class ProfileService {
    static async getProfileResponse(userId: string, guildId: string, username: string, viewerId?: string) {

        const requestingUser = viewerId || userId;
        const cacheKey = `view:profile:${guildId}:${userId}:${requestingUser}`;

        // 1. Cache Check
        const cachedData = await redisCache.get(cacheKey);
        if (cachedData) return JSON.parse(cachedData);

        // 2. The "Super Query"
        // We fetch the User, their Stock, their Portfolio, AND the viewer's specific holding in that stock
        const user = await prisma.user.findUnique({
            where: {
                discordId_guildId: {
                    discordId: userId,
                    guildId
                }
            },
            include: {
                stock: {
                    include: {
                        portfolios: viewerId && viewerId !== userId ? {
                            where: {
                                owner: {
                                    discordId: viewerId,
                                    guildId: guildId
                                }
                            },
                            select: {
                                shares: true
                            },
                            take: 1
                        } : false
                    }
                },
                portfolio: {
                    take: 10,
                    orderBy: { shares: 'desc' },
                    include: { stock: true }
                },
                _count: {
                    select: { portfolio: true }
                }
            }
        });

        if (!user) return null;

        // 3. Majority Shareholder (The only remaining separate call)
        let majorityShareholderUsername: string | null = null;

        if (user.stock) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ShareholderService } = require('./shareholderService');
            const maj = await ShareholderService.getMajorityShareholder(user.stock.id);
            if (maj) majorityShareholderUsername = maj.username;
        }

        const balance = new Decimal(String(user.balance));
        const netWorth = new Decimal(String(user.netWorth));
        const stockPrice = new Decimal(String(user.stock?.currentPrice ?? 0));
        const totalShares = new Decimal(user.stock?.totalShares ?? 1000);
        const marketCap = stockPrice.times(totalShares);

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Profile`)
            .setColor(Colors.Primary);

        // Handle Stock & Viewer Logic
        if (user.stock) {
            if (majorityShareholderUsername) {
                embed.setDescription(`🔒 **Property of ${majorityShareholderUsername}**`);
            }

            const outstanding = user.stock.sharesOutstanding;
            const maxShares = user.stock.totalShares;
            const supplyPct = ((outstanding / maxShares) * 100).toFixed(1);

            embed.addFields({
                name: 'Supply',
                value: `${outstanding}/${maxShares} (${supplyPct}%)`,
                inline: true
            });

            const viewerHoldingEntry = user.stock.portfolios?.[0];
            if (viewerHoldingEntry) {
                embed.addFields({
                    name: 'Your Position',
                    value: `${viewerHoldingEntry.shares} shares`,
                    inline: true
                });
            }
        }

        embed.addFields(
            { name: 'Net Worth', value: `$${netWorth.toFixed(2)}`, inline: true },
            { name: 'Balance', value: `$${balance.toFixed(2)}`, inline: true },
            { name: 'Stock Price', value: `$${stockPrice.toFixed(2)}`, inline: true },
            { name: 'Market Cap', value: `$${marketCap.toFixed(2)}`, inline: true },
        );

        // Portfolio Display
        if (user.portfolio.length > 0) {
            const portfolioDesc = user.portfolio.map(p => {
                const currentPrice = new Decimal(String(p.stock.currentPrice));
                const avgBuyPrice = new Decimal(String(p.averageBuyPrice));

                let profitPct = new Decimal(0);
                if (!avgBuyPrice.isZero()) {
                    profitPct = currentPrice.minus(avgBuyPrice).div(avgBuyPrice).times(100);
                }

                const emoji = profitPct.gte(0) ? '🟢' : '🔴';
                return `**${p.stock.symbol}**: ${p.shares} shares @ $${avgBuyPrice.toFixed(2)} (Cur: $${currentPrice.toFixed(2)}) ${emoji} ${profitPct.toFixed(1)}%`;
            }).join('\n');

            const remaining = user._count.portfolio - user.portfolio.length;
            const extraText = remaining > 0 ? `\n...and ${remaining} more.` : '';

            embed.addFields({ name: 'Your Portfolio', value: (portfolioDesc + extraText).substring(0, 1024) });
        } else {
            embed.addFields({ name: 'Your Portfolio', value: "You don't own any stocks yet. Use `/market` to find some!" });
        }

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder().setCustomId('refresh_profile').setLabel(ButtonLabels.Refresh).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Refresh),
                new ButtonBuilder().setCustomId('refresh_market').setLabel(ButtonLabels.Market).setStyle(ButtonStyle.Success).setEmoji(Emojis.Market),
                new ButtonBuilder().setCustomId('refresh_leaderboard').setLabel(ButtonLabels.Leaderboard).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Leaderboard),
                new ButtonBuilder().setCustomId('view_help').setLabel(ButtonLabels.Help).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Help)
            );

        const responsePayload = { embeds: [embed], components: [row] };
        await redisCache.set(cacheKey, JSON.stringify(responsePayload), 'EX', 15);

        return responsePayload;
    }
}