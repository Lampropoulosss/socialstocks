import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import prisma from '../prisma';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your stock profile and balance'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const discordId = interaction.user.id;
        const guildId = interaction.guildId!;

        const user = await prisma.user.findUnique({
            where: {
                discordId_guildId: {
                    discordId,
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
            await interaction.editReply("You don't have a profile yet. Start chatting to generate one!");
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Profile`)
            .setColor(0x0099FF)
            .addFields(
                { name: 'Balance', value: `$${Number(user.balance).toFixed(2)}`, inline: true },
                { name: 'Your Stock Price', value: `$${Number(user.stock?.currentPrice || 0).toFixed(2)}`, inline: true },
                { name: 'Shares Owned (Yourself)', value: `${user.stock?.totalShares}`, inline: true },
            );

        if (user.portfolio.length > 0) {
            const portfolioDesc = user.portfolio.map(p => {
                const currentValue = Number(p.stock.currentPrice);
                // const profit = (currentValue - Number(p.averageBuyPrice)) * p.shares;
                return `**${p.stock.symbol}**: ${p.shares} shares @ $${Number(p.averageBuyPrice).toFixed(2)} (Cur: $${currentValue.toFixed(2)})`;
            }).join('\n');

            embed.addFields({ name: 'Portfolio', value: portfolioDesc.substring(0, 1024) || "None" });
        }

        await interaction.editReply({ embeds: [embed] });
    },
};
