import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class ProfileService {
    static async getProfileResponse(userId: string, guildId: string, username: string) {
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
                        stock: true // Join stock info to see current prices
                    }
                }
            }
        });

        if (!user) {
            return null; // Handle null in caller
        }

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Profile`)
            .setColor(Colors.Primary)
            .addFields(
                { name: 'Balance', value: `$${Number(user.balance).toFixed(2)}`, inline: true },
                { name: 'Your Stock Price', value: `$${Number(user.stock?.currentPrice || 0).toFixed(2)}`, inline: true },
                {
                    name: 'Shares Owned (Yourself)',
                    value: `${user.portfolio.find(p => p.stockId === user.stock?.id)?.shares || 0} / ${user.stock?.totalShares || 0}`,
                    inline: true
                },
            );

        if (user.portfolio.length > 0) {
            const portfolioDesc = user.portfolio.map(p => {
                const currentValue = Number(p.stock.currentPrice);
                return `**${p.stock.symbol}**: ${p.shares} shares @ $${Number(p.averageBuyPrice).toFixed(2)} (Cur: $${currentValue.toFixed(2)})`;
            }).join('\n');

            embed.addFields({ name: 'Portfolio', value: portfolioDesc.substring(0, 1024) || "None" });
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
