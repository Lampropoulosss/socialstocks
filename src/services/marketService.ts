import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class MarketService {
    static async getMarketResponse(guildId: string) {
        const stocks = await prisma.stock.findMany({
            where: {
                user: {
                    guildId: guildId
                }
            },
            orderBy: { currentPrice: 'desc' },
            take: 10,
            include: {
                user: true,

            }
        });

        const embed = new EmbedBuilder()
            .setTitle(`Market Leaderboard`)
            .setColor(Colors.Success);

        const description = stocks.map((s, i) => {
            const current = Number(s.currentPrice);
            return `${i + 1}. **${s.symbol}** (${s.user.username}): $${current.toFixed(2)}`;
        }).join('\n');

        embed.setDescription(description || "No active stocks yet.");

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_market')
                    .setLabel(ButtonLabels.Refresh)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Refresh),
                new ButtonBuilder()
                    .setCustomId('refresh_profile')
                    .setLabel(ButtonLabels.Profile)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(Emojis.Profile),
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
