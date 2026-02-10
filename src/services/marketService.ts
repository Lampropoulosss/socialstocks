import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../prisma';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class MarketService {
    private static readonly PAGE_SIZE = 10;

    static async getMarketResponse(guildId: string, page: number = 1) {
        // 1. Fetch data and count in parallel to minimize DB wait time
        const [totalStocks, stocks] = await Promise.all([
            prisma.stock.count({ where: { user: { guildId, isOptedOut: false } } }),
            prisma.stock.findMany({
                where: { user: { guildId, isOptedOut: false } },
                orderBy: { currentPrice: 'desc' },
                skip: (page - 1) * this.PAGE_SIZE,
                take: this.PAGE_SIZE,
                include: { user: { select: { username: true } } }
            })
        ]);

        const totalPages = Math.ceil(totalStocks / this.PAGE_SIZE) || 1;
        const currentPage = Math.max(1, Math.min(page, totalPages));

        const embed = new EmbedBuilder()
            .setTitle(`${Emojis.Market || '📈'} Market Leaderboard`)
            .setColor(Colors.Success)
            .setFooter({ text: `Page ${currentPage} of ${totalPages} • Total: ${totalStocks} stocks` });

        const description = stocks.length > 0
            ? stocks.map((s, i) => {
                const rank = (currentPage - 1) * this.PAGE_SIZE + i + 1;
                return `**${rank}.** \`${s.symbol}\` (${s.user.username}): **$${Number(s.currentPrice).toLocaleString()}**`;
            }).join('\n')
            : "No active stocks found in this server.";

        embed.setDescription(description);

        // 2. Navigation Row (Stateless)
        const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`market_page_${currentPage - 1}`)
                .setEmoji(Emojis.Previous)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId('market_stats')
                .setLabel(`Page ${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`market_page_${currentPage + 1}`)
                .setEmoji(Emojis.Next)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );

        // 3. Action Row
        const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`market_page_${currentPage}`)
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

        return { embeds: [embed], components: [navRow, actionRow] };
    }
}