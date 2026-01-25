import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import prisma from '../prisma';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('View top stocks in the market'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const stocks = await prisma.stock.findMany({
            orderBy: { currentPrice: 'desc' },
            take: 10,
            include: {
                user: true,
                history: { orderBy: { recordedAt: 'desc' }, take: 1 } // Fetch last history entry
            }
        });

        const embed = new EmbedBuilder()
            .setTitle(`Market Leaderboard`)
            .setColor(0x00FF00);

        const description = stocks.map((s, i) => {
            const current = Number(s.currentPrice);
            const previous = s.history[0] ? Number(s.history[0].price) : current;
            let arrow = "➖";
            if (current > previous) arrow = "📈";
            if (current < previous) arrow = "📉";

            return `${i + 1}. **${s.symbol}** (${s.user.username}): $${current.toFixed(2)} ${arrow}`;
        }).join('\n');

        embed.setDescription(description || "No active stocks yet.");

        await interaction.editReply({ embeds: [embed] });
    },
};
