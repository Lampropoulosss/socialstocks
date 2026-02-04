import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class ProfileService {
    static async getProfileResponse(userId: string, guildId: string, username: string) {

        const cacheKey = `view:profile:${guildId}:${userId}`;
        const cachedData = await redisCache.get(cacheKey);

        if (cachedData) {
            return JSON.parse(cachedData);
        }

        const user = await prisma.user.findUnique({
            where: {
                discordId_guildId: {
                    discordId: userId,
                    guildId
                }
            },
            include: {
                stock: true,
                portfolio: {
                    take: 10,
                    orderBy: {
                        shares: 'desc'
                    },
                    include: {
                        stock: true
                    }
                },
                _count: {
                    select: {
                        portfolio: true
                    }
                }
            }
        });

        if (!user) {
            return null;
        }

        const balance = new Decimal(String(user.balance));
        const netWorth = new Decimal(String(user.netWorth));
        const stockPrice = new Decimal(String(user.stock?.currentPrice || 0));
        const totalShares = new Decimal(user.stock?.totalShares || 1000);
        const marketCap = stockPrice.times(totalShares);

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Profile`)
            .setColor(Colors.Primary);

        if (user.stock) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ShareholderService } = require('./shareholderService');
            const majorityShareholder = await ShareholderService.getMajorityShareholder(user.stock.id);

            if (majorityShareholder) {
                embed.setDescription(`🔒 **Property of ${majorityShareholder.username}**`);
            }
        }

        embed.addFields(
            { name: 'Net Worth', value: `$${netWorth.toFixed(2)}`, inline: true },
            { name: 'Balance', value: `$${balance.toFixed(2)}`, inline: true },
            { name: 'Stock Price', value: `$${stockPrice.toFixed(2)}`, inline: true },
            { name: 'Market Cap', value: `$${marketCap.toFixed(2)}`, inline: true },
        );

        if (user.portfolio.length > 0) {
            const topStocks = user.portfolio;

            const portfolioDesc = topStocks.map(p => {
                const currentPrice = new Decimal(String(p.stock.currentPrice));
                const avgBuyPrice = new Decimal(String(p.averageBuyPrice));

                let profitPct = new Decimal(0);
                if (!avgBuyPrice.isZero()) {
                    profitPct = currentPrice.minus(avgBuyPrice).div(avgBuyPrice).times(100);
                }

                const emoji = profitPct.gte(0) ? '🟢' : '🔴';
                return `**${p.stock.symbol}**: ${p.shares} shares @ $${avgBuyPrice.toFixed(2)} (Cur: $${currentPrice.toFixed(2)}) ${emoji} ${profitPct.toFixed(1)}%`;
            }).join('\n');

            const remaining = user._count.portfolio - topStocks.length;
            const extraText = remaining > 0 ? `\n...and ${remaining} more.` : '';

            embed.addFields({ name: 'Your Portfolio', value: (portfolioDesc + extraText).substring(0, 1024) || "None" });
        } else {
            embed.addFields({ name: 'Your Portfolio', value: "You don't own any stocks yet. Use `/market` to find some!" });
        }

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                // ... existing buttons ...
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