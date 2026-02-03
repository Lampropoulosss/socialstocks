import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';
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


        if (targetUser.id === buyerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You cannot buy stock in yourself. That would be insider trading!");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (targetUser.bot) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You cannot buy stock in bots.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const buyer = await prisma.user.findUnique({
            where: {
                discordId_guildId: { discordId: buyerId, guildId }
            }
        });

        if (!buyer) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You need a profile to buy stocks. Send a message to generate one.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        try {
            const result = await prisma.$transaction(async (tx) => {
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
                const currentPrice = new Decimal(String(currentStock.currentPrice));

                if (maxPriceInput) {
                    const maxPrice = new Decimal(maxPriceInput);
                    if (currentPrice.greaterThan(maxPrice)) {
                        throw new Error(`Price spike detected! Current: $${currentPrice.toFixed(2)}, Max: $${maxPrice.toFixed(2)}. Transaction aborted.`);
                    }
                }

                const cost = currentPrice.times(amount);

                const freshBuyer = await tx.user.findUnique({
                    where: { id: buyer.id }
                });

                const balance = new Decimal(String(freshBuyer?.balance || 0));

                if (balance.lessThan(cost)) {
                    throw new Error(`Insufficient funds. Cost: $${cost.toFixed(2)}, Balance: $${balance.toFixed(2)}`);
                }

                await tx.user.update({
                    where: { id: buyer.id },
                    data: { balance: balance.minus(cost).toString() }
                });

                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: buyer.id, stockId: currentStock.id } }
                });

                if (portfolio) {
                    const totalShares = portfolio.shares + amount;
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

                return { symbol: currentStock.symbol, shares: amount, cost, price: currentPrice };
            });

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Transaction Successful")
                .setDescription(`Successfully bought **${result.shares}** shares of **${result.symbol}**.`)
                .addFields(
                    { name: 'Cost', value: `$${result.cost.toFixed(2)}`, inline: true },
                    { name: 'Average Price', value: `$${result.price.toFixed(2)}`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setTitle("❌ Transaction Failed")
                .setDescription(error.message || "An unexpected error occurred.");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
