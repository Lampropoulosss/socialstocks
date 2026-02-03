import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { redisCache } from '../redis'; // Import Redis
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class ProfileService {
    static async getProfileResponse(userId: string, guildId: string, username: string) {

        // 1. CHECK CACHE FIRST
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
                    include: {
                        stock: true
                    }
                }
            }
        });

        if (!user) {
            return null;
        }

        const balance = new Decimal(String(user.balance));
        const stockPrice = new Decimal(String(user.stock?.currentPrice || 0));
        const totalShares = new Decimal(user.stock?.totalShares || 1000);
        const marketCap = stockPrice.times(totalShares);

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Profile`)
            .setColor(Colors.Primary);

        if (user.stock) {
            // This is now safer thanks to the DB Index we added
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ShareholderService } = require('./shareholderService');
            const majorityShareholder = await ShareholderService.getMajorityShareholder(user.stock.id);

            if (majorityShareholder) {
                embed.setDescription(`🔒 **Property of ${majorityShareholder.username}**`);
            }
        }

        embed.addFields(
            { name: 'Balance', value: `$${balance.toFixed(2)}`, inline: true },
            { name: 'Stock Price', value: `$${stockPrice.toFixed(2)}`, inline: true },
            { name: 'Market Cap', value: `$${marketCap.toFixed(2)}`, inline: true },
        );

        // Limit portfolio display to prevent massive loops
        if (user.portfolio.length > 0) {
            const sortedPortfolio = [...user.portfolio].sort((a, b) => {
                const valA = Number(a.stock.currentPrice) * a.shares;
                const valB = Number(b.stock.currentPrice) * b.shares;
                return valB - valA;
            });

            // OPTIMIZATION: Only show top 10 stocks to save CPU/Message Size
            const topStocks = sortedPortfolio.slice(0, 10);

            const portfolioDesc = topStocks.map(p => {
                const currentPrice = new Decimal(String(p.stock.currentPrice));
                const avgBuyPrice = new Decimal(String(p.averageBuyPrice));
                const profitPct = currentPrice.minus(avgBuyPrice).div(avgBuyPrice).times(100);
                const emoji = profitPct.gte(0) ? '🟢' : '🔴';
                return `**${p.stock.symbol}**: ${p.shares} shares @ $${avgBuyPrice.toFixed(2)} (Cur: $${currentPrice.toFixed(2)}) ${emoji} ${profitPct.toFixed(1)}%`;
            }).join('\n');

            const remaining = user.portfolio.length - 10;
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

        // 2. SET CACHE (Expire in 15 seconds)
        // We cache the result so spamming the button reads from RAM, not DB
        await redisCache.set(cacheKey, JSON.stringify(responsePayload), 'EX', 15);

        return responsePayload;
    }
}