import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TransactionType } from '@prisma/client';
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

        // Resolve internal IDs
        const seller = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: sellerDiscordId, guildId } }
        });

        const targetUserDb = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: targetUser.id, guildId } },
            include: { stock: true }
        });

        if (!seller) {
            await interaction.editReply("You don't have a profile.");
            return;
        }

        if (!targetUserDb || !targetUserDb.stock) {
            await interaction.editReply("Stock not found.");
            return;
        }

        const sellerId = seller.id;
        const stock = targetUserDb.stock;

        const portfolio = await prisma.portfolio.findUnique({
            where: { ownerId_stockId: { ownerId: sellerId, stockId: stock.id } }
        });

        if (!portfolio || portfolio.shares < amount) {
            await interaction.editReply(`You do not have enough shares. Owned: ${portfolio?.shares || 0}`);
            return;
        }

        const TAX_RATE = 0.10;
        const currentValue = Number(stock.currentPrice);
        const grossRevenue = currentValue * amount;
        const tax = grossRevenue * TAX_RATE;
        const netRevenue = grossRevenue - tax;

        // Profit calculation based on average buy price
        // Note: Profit is Realized PnL. 
        // Realized PnL = (Sell Price - Buy Price) * quantity - Tax?
        // Usually Tax is an expense. So yes.
        const costBasis = Number(portfolio.averageBuyPrice) * amount;
        const profit = netRevenue - costBasis;

        try {
            await prisma.$transaction(async (tx) => {
                // Add balance
                await tx.user.update({
                    where: { id: sellerId },
                    data: { balance: { increment: netRevenue } }
                });

                // Update Portfolio
                if (portfolio.shares === amount) {
                    await tx.portfolio.delete({ where: { id: portfolio.id } });
                } else {
                    await tx.portfolio.update({
                        where: { id: portfolio.id },
                        data: { shares: { decrement: amount } }
                    });
                }

                // Log Transaction
                await tx.transaction.create({
                    data: {
                        userId: sellerId,
                        stockId: stock.id,
                        type: TransactionType.SELL,
                        shares: amount,
                        pricePerShare: currentValue, // Market price at time of sale
                        totalCost: netRevenue // Money received
                    }
                });
            });

            const profitSign = profit >= 0 ? '+' : '-';
            await interaction.editReply(`Sold ${amount} shares of **${stock.symbol}** for $${netRevenue.toFixed(2)} (Tax: $${tax.toFixed(2)}). Profit: ${profitSign}$${Math.abs(profit).toFixed(2)}`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("Transaction failed.");
        }
    },
};
