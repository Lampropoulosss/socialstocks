import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import { ProfileService } from '../services/profileService';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';

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
        const buyerDiscordId = interaction.user.id;
        const guildId = interaction.guildId!;

        if (targetUser.id === buyerDiscordId) return errorReply(interaction, "🚫 You cannot buy stock in yourself.");
        if (targetUser.bot) return errorReply(interaction, "🚫 You cannot buy stock in bots.");

        const isTargetOptedOut = await ProfileService.isUserOptedOut(targetUser.id, guildId);
        if (isTargetOptedOut) return errorReply(interaction, `🚫 **${targetUser.username}** has opted out.`);

        try {
            type UserWithStock = Prisma.UserGetPayload<{ include: { stock: true } }>;

            const users: UserWithStock[] = await prisma.user.findMany({
                where: {
                    guildId: guildId,
                    discordId: { in: [buyerDiscordId, targetUser.id] }
                },
                include: { stock: true }
            });

            const buyer = users.find(u => u.discordId === buyerDiscordId);
            const target = users.find(u => u.discordId === targetUser.id);

            if (!buyer) return errorReply(interaction, "🚫 You need a profile. Send a message to generate one.");
            if (!target || !target.stock) return errorReply(interaction, "🚫 Target user has no stock initialized.");

            const stock = target.stock;
            const currentPrice = new Decimal(String(stock.currentPrice));
            const cost = currentPrice.times(amount);

            if (maxPriceInput && currentPrice.gt(maxPriceInput)) {
                return errorReply(interaction, `Price spike! Current: $${currentPrice.toFixed(2)} > Max: $${maxPriceInput}`);
            }

            const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const deductRes = await tx.user.updateMany({
                    where: {
                        id: buyer.id,
                        balance: { gte: cost.toFixed(2) }
                    },
                    data: { balance: { decrement: cost.toFixed(2) } }
                });

                if (deductRes.count === 0) throw new Error(`Insufficient funds. You need $${cost.toFixed(2)}.`);

                const supplyRatio = new Decimal(amount).div(stock.totalShares);
                const priceIncreasePct = supplyRatio.times(0.5);
                let newPrice = currentPrice.times(new Decimal(1).plus(priceIncreasePct));
                if (newPrice.gt(currentPrice.times(1.5))) newPrice = currentPrice.times(1.5);

                const stockRes = await tx.stock.updateMany({
                    where: {
                        id: stock.id,
                        sharesOutstanding: { lte: stock.totalShares - amount }
                    },
                    data: {
                        sharesOutstanding: { increment: amount },
                        currentPrice: newPrice.toFixed(2),
                        updatedAt: new Date()
                    }
                });

                if (stockRes.count === 0) {
                    await tx.user.update({ where: { id: buyer.id }, data: { balance: { increment: cost.toFixed(2) } } });
                    throw new Error(`Sold out! Not enough shares remaining.`);
                }

                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: buyer.id, stockId: stock.id } }
                });

                if ((portfolio?.shares || 0) + amount > stock.maxHoldingPerUser) {
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

                return { symbol: stock.symbol, shares: amount, cost, price: currentPrice, newPrice };
            });

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Trade Executed")
                .setDescription(`Bought **${result.shares}** shares of **${result.symbol}**`)
                .addFields(
                    { name: 'Debit', value: `-$${result.cost.toFixed(2)}`, inline: true },
                    { name: 'Entry Price', value: `$${result.price.toFixed(2)}`, inline: true },
                    { name: 'New Price 📈', value: `$${result.newPrice.toFixed(2)}`, inline: true }
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