import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';

import prisma from '../prisma';
import Decimal from 'decimal.js';

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

        // 1. Basic User Checks (No Transaction Needed yet)
        const seller = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: sellerDiscordId, guildId } }
        });

        if (!seller) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You don't have a profile.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        try {
            // 2. Everything sensitive moves INSIDE the transaction
            const result = await prisma.$transaction(async (tx) => {

                // A. Re-fetch Target & Stock to be safe
                const targetUserDb = await tx.user.findUnique({
                    where: { discordId_guildId: { discordId: targetUser.id, guildId } },
                    include: { stock: true }
                });

                if (!targetUserDb || !targetUserDb.stock) {
                    throw new Error("🚫 Stock not found.");
                }

                const stock = targetUserDb.stock;

                // B. Fetch Portfolio (INSIDE TX) to lock/verify current state
                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: seller.id, stockId: stock.id } }
                });

                if (!portfolio || portfolio.shares < amount) {
                    throw new Error(`🚫 You do not have enough shares. Owned: ${portfolio?.shares || 0}`);
                }

                // C. Calculate Finances
                const TAX_RATE = new Decimal(0.10);
                const currentPrice = new Decimal(String(stock.currentPrice));
                const sharesToSell = new Decimal(amount);

                const grossRevenue = currentPrice.times(sharesToSell);
                const tax = grossRevenue.times(TAX_RATE).toDecimalPlaces(2);
                const netRevenue = grossRevenue.minus(tax);

                const averageBuyPrice = new Decimal(String(portfolio.averageBuyPrice));
                const costBasis = averageBuyPrice.times(sharesToSell);
                const profit = netRevenue.minus(costBasis);

                // D. Update Balance
                await tx.user.update({
                    where: { id: seller.id },
                    data: { balance: { increment: netRevenue.toFixed(2) } }
                });

                // E. Update Global Supply (Decrement sharesOutstanding)
                await tx.stock.update({
                    where: { id: stock.id },
                    data: { sharesOutstanding: { decrement: amount } }
                });

                // F. Update Portfolio
                if (portfolio.shares === amount) {
                    await tx.portfolio.delete({ where: { id: portfolio.id } });
                } else {
                    await tx.portfolio.update({
                        where: { id: portfolio.id },
                        data: { shares: { decrement: amount } }
                    });
                }

                return {
                    symbol: stock.symbol,
                    netRevenue,
                    tax,
                    profit
                };
            });

            // 3. Send Success Response (Outside TX)
            const profitSign = result.profit.greaterThanOrEqualTo(0) ? '+' : '-';

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Sale Successful")
                .setDescription(`Sold **${amount}** shares of **${result.symbol}**.`)
                .addFields(
                    { name: 'Net Revenue', value: `$${result.netRevenue.toFixed(2)}`, inline: true },
                    { name: 'Tax Paid', value: `$${result.tax.toFixed(2)}`, inline: true },
                    { name: 'Profit', value: `${profitSign}$${result.profit.abs().toFixed(2)}`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setTitle("❌ Transaction Failed")
                .setDescription(error.message || "An error occurred while processing your sale.");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};