import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../prisma';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy shares of a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to invest in')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of shares to buy')
                .setMinValue(1)
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('max_price')
                .setDescription('Maximum price per share you are willing to pay')
                .setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user')!;
        const amount = interaction.options.getInteger('amount')!;
        const maxPriceInput = interaction.options.getNumber('max_price');
        const buyerId = interaction.user.id;
        const guildId = interaction.guildId!;

        if (targetUser.bot) {
            await interaction.editReply("You cannot buy stock in bots.");
            return;
        }

        // Fetch Buyer to check existence/balance (pre-check)
        const buyer = await prisma.user.findUnique({
            where: {
                discordId_guildId: { discordId: buyerId, guildId }
            }
        });

        if (!buyer) {
            await interaction.editReply("You need a profile to buy stocks. Send a message to generate one.");
            return;
        }

        try {
            const result = await prisma.$transaction(async (tx) => {
                // 1. Fetch Target User AND their stock using Discord ID
                // Fixes the ID mismatch bug by querying via discordId_guildId
                const targetUserDb = await tx.user.findUnique({
                    where: {
                        discordId_guildId: { discordId: targetUser.id, guildId }
                    },
                    include: { stock: true }
                });

                if (!targetUserDb || !targetUserDb.stock) {
                    throw new Error("This user does not have a stock yet.");
                }

                const currentStock = targetUserDb.stock;
                // Use Decimal.js for precision math
                const currentPrice = new Decimal(String(currentStock.currentPrice));

                // Anti-Snipe Check
                if (maxPriceInput) {
                    const maxPrice = new Decimal(maxPriceInput);
                    if (currentPrice.greaterThan(maxPrice)) {
                        throw new Error(`Price spike detected! Current: $${currentPrice.toFixed(2)}, Max: $${maxPrice.toFixed(2)}. Transaction aborted.`);
                    }
                }

                const cost = currentPrice.times(amount);

                // 2. Lock & Check Buyer
                const freshBuyer = await tx.user.findUnique({
                    where: { id: buyer.id }
                });

                const balance = new Decimal(String(freshBuyer?.balance || 0));

                if (balance.lessThan(cost)) {
                    throw new Error(`Insufficient funds. Cost: $${cost.toFixed(2)}, Balance: $${balance.toFixed(2)}`);
                }

                // 3. Deduct balance
                await tx.user.update({
                    where: { id: buyer.id },
                    data: { balance: balance.minus(cost).toString() } // Prisma handles Decimal object
                });

                // Update Portfolio
                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: buyer.id, stockId: currentStock.id } }
                });

                if (portfolio) {
                    // Update average buy price
                    const totalShares = portfolio.shares + amount;
                    // Calculate weighted average: ((oldAvg * oldShares) + cost) / newTotalShares
                    const oldTotalCost = new Decimal(String(portfolio.averageBuyPrice)).times(portfolio.shares);
                    const newAverage = oldTotalCost.plus(cost).div(totalShares);

                    await tx.portfolio.update({
                        where: { id: portfolio.id },
                        data: {
                            shares: { increment: amount },
                            averageBuyPrice: newAverage.toString()
                        }
                    });
                } else {
                    await tx.portfolio.create({
                        data: {
                            ownerId: buyer.id,
                            stockId: currentStock.id,
                            shares: amount,
                            averageBuyPrice: currentPrice.toString()
                        }
                    });
                }

                // Log Transaction
                await tx.transaction.create({
                    data: {
                        userId: buyer.id,
                        stockId: currentStock.id,
                        type: TransactionType.BUY,
                        shares: amount,
                        pricePerShare: currentPrice.toString(),
                        totalCost: cost.toString()
                    }
                });

                // Trigger event-driven leaderboard update if possible, or leave for regular sync
                // For now, we rely on the scheduled task or future optimizations
                return { symbol: currentStock.symbol, shares: amount, cost, price: currentPrice };
            });

            await interaction.editReply(`Successfully bought ${result.shares} shares of **${result.symbol}** for $${result.cost.toFixed(2)} (Avg: $${result.price.toFixed(2)})!`);

        } catch (error: any) {
            await interaction.editReply(error.message || "Transaction failed due to an error.");
        }
    },
};
