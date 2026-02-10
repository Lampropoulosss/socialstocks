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
        // 1. Initial Setup
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user')!;
        const amount = interaction.options.getInteger('amount')!;
        const maxPriceInput = interaction.options.getNumber('max_price');
        const buyerId = interaction.user.id;
        const guildId = interaction.guildId!;

        // 2. Fast Validations
        if (targetUser.id === buyerId) return errorReply(interaction, "🚫 You cannot buy stock in yourself.");
        if (targetUser.bot) return errorReply(interaction, "🚫 You cannot buy stock in bots.");

        const isTargetOptedOut = await ProfileService.isUserOptedOut(targetUser.id, guildId);
        if (isTargetOptedOut) return errorReply(interaction, `🚫 **${targetUser.username}** has opted out.`);

        try {
            // 3. Pre-flight Check (Read-Only, Fast)
            // We fetch data to calculate costs before entering the transaction.
            const [buyer, target] = await Promise.all([
                prisma.user.findUnique({ where: { discordId_guildId: { discordId: buyerId, guildId } } }),
                prisma.user.findUnique({
                    where: { discordId_guildId: { discordId: targetUser.id, guildId } },
                    include: { stock: true }
                })
            ]);

            if (!buyer) return errorReply(interaction, "🚫 You need a profile. Send a message to generate one.");
            if (!target || !target.stock) return errorReply(interaction, "🚫 Target user has no stock initialized.");

            const stock = target.stock;
            const currentPrice = new Decimal(String(stock.currentPrice));
            const cost = currentPrice.times(amount);

            // Check Price Cap (Client side check is fine for UX, DB enforces truth)
            if (maxPriceInput && currentPrice.gt(maxPriceInput)) {
                return errorReply(interaction, `Price spike! Current: $${currentPrice.toFixed(2)} > Max: $${maxPriceInput}`);
            }

            // 4. The "Atomic Guard" Transaction
            // This is the fastest way to handle money. No locks.
            const result = await prisma.$transaction(async (tx) => {

                // STEP A: Deduct Balance (Atomic Check)
                // We use updateMany because it allows a "where" clause on non-unique fields (balance).
                // "Decrement balance by Cost ONLY IF balance >= Cost"
                const deductRes = await tx.user.updateMany({
                    where: {
                        id: buyer.id,
                        balance: { gte: cost.toFixed(2) } // The Guard Clause
                    },
                    data: {
                        balance: { decrement: cost.toFixed(2) }
                    }
                });

                if (deductRes.count === 0) {
                    throw new Error(`Insufficient funds. You need $${cost.toFixed(2)}.`);
                }

                // STEP B: Secure Shares (Atomic Check)
                // "Increment sharesOutstanding ONLY IF new total <= totalShares"
                const stockRes = await tx.stock.updateMany({
                    where: {
                        id: stock.id,
                        sharesOutstanding: { lte: stock.totalShares - amount } // The Guard Clause
                    },
                    data: {
                        sharesOutstanding: { increment: amount }
                    }
                });

                if (stockRes.count === 0) {
                    // Refund the user if stock fails!
                    await tx.user.update({
                        where: { id: buyer.id },
                        data: { balance: { increment: cost.toFixed(2) } }
                    });
                    throw new Error(`Sold out! Not enough shares remaining.`);
                }

                // STEP C: Update Portfolio
                // Since we passed the guards, we are safe to update the portfolio.
                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: buyer.id, stockId: stock.id } }
                });

                if (portfolio) {
                    // Check holding cap
                    if (portfolio.shares + amount > stock.maxHoldingPerUser) {
                        // Rollback everything manually (throw error triggers auto-rollback of tx)
                        throw new Error(`Holding limit reached! Max: ${stock.maxHoldingPerUser}`);
                    }

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

            // 5. Success Response
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

// Helper for clean error replies
async function errorReply(interaction: ChatInputCommandInteraction, msg: string) {
    const embed = new EmbedBuilder().setColor(Colors.Danger).setDescription(msg);
    if (interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
}