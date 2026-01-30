import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class ProfileService {
    static async getProfileResponse(userId: string, guildId: string, username: string) {
        // 1. Fetch User, Stock, and Portfolio
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

        // 2. Calculate Stats
        const balance = new Decimal(String(user.balance));
        const stockPrice = new Decimal(String(user.stock?.currentPrice || 0));
        const totalShares = new Decimal(user.stock?.totalShares || 1000);

        // Market Cap logic
        const marketCap = stockPrice.times(totalShares);

        // 3. Build Embed
        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Profile`)
            .setColor(Colors.Primary)
            .addFields(
                {
                    name: 'Balance',
                    value: `$${balance.toFixed(2)}`,
                    inline: true
                },
                {
                    name: 'Stock Price',
                    value: `$${stockPrice.toFixed(2)}`,
                    inline: true
                },
                {
                    name: 'Market Cap',
                    value: `$${marketCap.toFixed(2)}`,
                    inline: true
                },
            );

        // 4. Portfolio Formatting
        if (user.portfolio.length > 0) {
            // Sort: Highest Value First
            const sortedPortfolio = [...user.portfolio].sort((a, b) => {
                const valA = Number(a.stock.currentPrice) * a.shares;
                const valB = Number(b.stock.currentPrice) * b.shares;
                return valB - valA;
            });

            const portfolioDesc = sortedPortfolio.map(p => {
                const currentPrice = new Decimal(String(p.stock.currentPrice));
                const avgBuyPrice = new Decimal(String(p.averageBuyPrice));

                // Calculate Profit %
                const profitPct = currentPrice.minus(avgBuyPrice).div(avgBuyPrice).times(100);

                // FIX: Use .gte(0) (Greater Than or Equal to 0) instead of .isPositive()
                const emoji = profitPct.gte(0) ? '🟢' : '🔴';

                return `**${p.stock.symbol}**: ${p.shares} shares @ $${avgBuyPrice.toFixed(2)} (Cur: $${currentPrice.toFixed(2)}) ${emoji} ${profitPct.toFixed(1)}%`;
            }).join('\n');

            embed.addFields({ name: 'Your Portfolio', value: portfolioDesc.substring(0, 1024) || "None" });
        } else {
            embed.addFields({ name: 'Your Portfolio', value: "You don't own any stocks yet. Use `/market` to find some!" });
        }

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_profile')
                    .setLabel(ButtonLabels.Refresh)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Refresh),
                new ButtonBuilder()
                    .setCustomId('refresh_market')
                    .setLabel(ButtonLabels.Market)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(Emojis.Market),
                new ButtonBuilder()
                    .setCustomId('refresh_leaderboard')
                    .setLabel(ButtonLabels.Leaderboard)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Leaderboard),
                new ButtonBuilder()
                    .setCustomId('view_help')
                    .setLabel(ButtonLabels.Help)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Help)
            );

        return { embeds: [embed], components: [row] };
    }
}