import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import { ProfileService } from '../services/profileService';
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

        // 1. Basic Identity Validations
        if (targetUser.id === buyerId) return errorReply(interaction, "🚫 You cannot buy stock in yourself.");
        if (targetUser.bot) return errorReply(interaction, "🚫 You cannot buy stock in bots.");

        const isTargetOptedOut = await ProfileService.isUserOptedOut(targetUser.id, guildId);
        if (isTargetOptedOut) return errorReply(interaction, `🚫 **${targetUser.username}** has opted out.`);

        try {
            const [buyer, target, existingPortfolio] = await Promise.all([
                prisma.user.findUnique({ where: { discordId_guildId: { discordId: buyerId, guildId } } }),
                prisma.user.findUnique({
                    where: { discordId_guildId: { discordId: targetUser.id, guildId } },
                    include: { stock: true }
                }),
                prisma.portfolio.findFirst({
                    where: {
                        owner: { discordId: buyerId, guildId },
                        stock: { userId: targetUser.id }
                    }
                })
            ]);

            if (!buyer) return errorReply(interaction, "🚫 You need a profile. Send a message to generate one.");
            if (!target || !target.stock) return errorReply(interaction, "🚫 Target user has no stock initialized.");

            const stock = target.stock;
            const currentPrice = new Decimal(String(stock.currentPrice));
            const cost = currentPrice.times(amount);

            const currentShares = existingPortfolio?.shares || 0;
            if (currentShares + amount > stock.maxHoldingPerUser) {
                return errorReply(interaction, `🚫 **Limit Reached:** You own ${currentShares} shares. Buying ${amount} more would exceed the limit of ${stock.maxHoldingPerUser}.`);
            }

            // Price Cap Validation
            if (maxPriceInput && currentPrice.gt(maxPriceInput)) {
                return errorReply(interaction, `Price spike! Current: $${currentPrice.toFixed(2)} > Max: $${maxPriceInput}`);
            }

            // 2. The "Atomic Guard" Transaction
            const result = await prisma.$transaction(async (tx) => {

                // STEP A: Deduct Balance (Atomic Check)
                const deductRes = await tx.user.updateMany({
                    where: {
                        id: buyer.id,
                        balance: { gte: cost.toFixed(2) }
                    },
                    data: {
                        balance: { decrement: cost.toFixed(2) }
                    }
                });

                if (deductRes.count === 0) {
                    throw new Error(`Insufficient funds. You need $${cost.toFixed(2)}.`);
                }

                // STEP B: Secure Shares (Atomic Check)
                const stockRes = await tx.stock.updateMany({
                    where: {
                        id: stock.id,
                        sharesOutstanding: { lte: stock.totalShares - amount }
                    },
                    data: {
                        sharesOutstanding: { increment: amount }
                    }
                });

                if (stockRes.count === 0) {
                    await tx.user.update({ where: { id: buyer.id }, data: { balance: { increment: cost.toFixed(2) } } });
                    throw new Error(`Sold out! Not enough shares remaining.`);
                }

                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: buyer.id, stockId: stock.id } }
                });

                // RE-CHECK INSIDE TX: Prevent Race Conditions
                const txCurrentShares = portfolio?.shares || 0;
                if (txCurrentShares + amount > stock.maxHoldingPerUser) {
                    throw new Error(`Holding limit reached! Max: ${stock.maxHoldingPerUser}`);
                }

                if (portfolio) {
                    const oldTotalCost = new Decimal(String(portfolio.averageBuyPrice)).times(portfolio.shares);
                    const newAverage = oldTotalCost.plus(cost).div(portfolio.shares + amount);

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
                            stockId: stock.id,
                            shares: amount,
                            averageBuyPrice: currentPrice.toString()
                        }
                    });
                }

                return { symbol: stock.symbol, shares: amount, cost, price: currentPrice };
            });

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Trade Executed")
                .setDescription(`Bought **${result.shares}** shares of **${result.symbol}**`)
                .addFields(
                    { name: 'Debit', value: `-$${result.cost.toFixed(2)}`, inline: true },
                    { name: 'Entry Price', value: `$${result.price.toFixed(2)}`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            return errorReply(interaction, error.message || "Transaction failed.");
        }
    },
};

async function errorReply(interaction: ChatInputCommandInteraction, msg: string) {
    const embed = new EmbedBuilder().setColor(Colors.Danger).setDescription(msg);
    if (interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
}