import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';

import prisma from '../prisma';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell shares of a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user stock to sell')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of shares to sell')
                .setMinValue(1)
                .setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user')!;
        const amount = interaction.options.getInteger('amount')!;
        const sellerDiscordId = interaction.user.id;
        const guildId = interaction.guildId!;

        const seller = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: sellerDiscordId, guildId } }
        });

        const targetUserDb = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: targetUser.id, guildId } },
            include: { stock: true }
        });

        if (!seller) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You don't have a profile.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (!targetUserDb || !targetUserDb.stock) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 Stock not found.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const sellerId = seller.id;
        const stock = targetUserDb.stock;

        const portfolio = await prisma.portfolio.findUnique({
            where: { ownerId_stockId: { ownerId: sellerId, stockId: stock.id } }
        });

        if (!portfolio || portfolio.shares < amount) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription(`🚫 You do not have enough shares. Owned: ${portfolio?.shares || 0}`);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const TAX_RATE = 0.10;
        const currentValue = Number(stock.currentPrice);
        const grossRevenue = currentValue * amount;
        const tax = grossRevenue * TAX_RATE;
        const netRevenue = grossRevenue - tax;

        const costBasis = Number(portfolio.averageBuyPrice) * amount;
        const profit = netRevenue - costBasis;

        try {
            await prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: sellerId },
                    data: { balance: { increment: netRevenue } }
                });

                if (portfolio.shares === amount) {
                    await tx.portfolio.delete({ where: { id: portfolio.id } });
                } else {
                    await tx.portfolio.update({
                        where: { id: portfolio.id },
                        data: { shares: { decrement: amount } }
                    });
                }
            });

            const profitSign = profit >= 0 ? '+' : '-';

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Sale Successful")
                .setDescription(`Sold **${amount}** shares of **${stock.symbol}**.`)
                .addFields(
                    { name: 'Net Revenue', value: `$${netRevenue.toFixed(2)}`, inline: true },
                    { name: 'Tax Paid', value: `$${tax.toFixed(2)}`, inline: true },
                    { name: 'Profit', value: `${profitSign}$${Math.abs(profit).toFixed(2)}`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setTitle("❌ Transaction Failed")
                .setDescription("An error occurred while processing your sale.");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
