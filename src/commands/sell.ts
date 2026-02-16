import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
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

        try {
            type UserWithStock = Prisma.UserGetPayload<{ include: { stock: true } }>;

            const users: UserWithStock[] = await prisma.user.findMany({
                where: {
                    guildId: guildId,
                    discordId: { in: [sellerDiscordId, targetUser.id] }
                },
                include: { stock: true }
            });

            const seller = users.find(u => u.discordId === sellerDiscordId);
            const target = users.find(u => u.discordId === targetUser.id);

            if (!seller) return errorReply(interaction, "🚫 You don't have a profile.");
            if (!target || !target.stock) return errorReply(interaction, "🚫 Stock not found.");

            const stock = target.stock;

            const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

                const portfolio = await tx.portfolio.findUnique({
                    where: { ownerId_stockId: { ownerId: seller.id, stockId: stock.id } }
                });

                if (!portfolio || portfolio.shares < amount) {
                    throw new Error(`🚫 You do not have enough shares. Owned: ${portfolio?.shares || 0}`);
                }

                const now = Date.now();
                // Handle legacy portfolios that might have null lastBuyAt (fallback to updatedAt or now)
                const lastBuyTime = portfolio.lastBuyAt ? portfolio.lastBuyAt.getTime() : portfolio.updatedAt.getTime();
                const hoursHeld = (now - lastBuyTime) / (1000 * 60 * 60);

                let taxRate = 0.08; // Base Rate (> 4 hours)
                let taxLabel = '8% (Long Term)';

                if (hoursHeld <= 1.0) {
                    taxRate = 0.15;
                    taxLabel = '15% (Flash Sale)';
                } else if (hoursHeld <= 2.0) {
                    taxRate = 0.125;
                    taxLabel = '12.5% (Short Term)';
                } else if (hoursHeld <= 4.0) {
                    taxRate = 0.10;
                    taxLabel = '10% (Medium Term)';
                }

                // Calculations
                const TAX_RATE = new Decimal(taxRate);
                const currentPrice = new Decimal(String(stock.currentPrice));
                const grossRevenue = currentPrice.times(amount);
                const tax = grossRevenue.times(TAX_RATE).toDecimalPlaces(2);
                const netRevenue = grossRevenue.minus(tax);

                const avgBuy = new Decimal(String(portfolio.averageBuyPrice));
                const profit = netRevenue.minus(avgBuy.times(amount));

                // Price Impact
                const supplyRatio = new Decimal(amount).div(stock.totalShares);
                const priceDropPct = supplyRatio.times(0.5);
                let newPrice = currentPrice.times(new Decimal(1).minus(priceDropPct));
                if (newPrice.lessThan(10)) newPrice = new Decimal(10);

                // Update Balance
                await tx.user.update({
                    where: { id: seller.id },
                    data: { balance: { increment: netRevenue.toFixed(2) } }
                });

                // Update Supply & Crash Price
                await tx.stock.update({
                    where: { id: stock.id },
                    data: {
                        sharesOutstanding: { decrement: amount },
                        currentPrice: newPrice.toFixed(2),
                        updatedAt: new Date()
                    }
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

                return {
                    symbol: stock.symbol,
                    netRevenue,
                    tax,
                    profit,
                    oldPrice: currentPrice,
                    newPrice,
                    taxLabel,
                    hoursHeld
                };
            });

            const profitSign = result.profit.gte(0) ? '+' : '-';
            const dropPercent = result.oldPrice.minus(result.newPrice).div(result.oldPrice).times(100);

            // Time formatting for display
            const hours = Math.floor(result.hoursHeld);
            const minutes = Math.floor((result.hoursHeld - hours) * 60);
            const timeHeldStr = `${hours}h ${minutes}m`;

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Sale Successful")
                .setDescription(`Sold **${amount}** shares of **${result.symbol}**.`)
                .addFields(
                    { name: 'Financials', value: `Gross: $${(result.netRevenue.plus(result.tax)).toFixed(2)}\nTax: -$${result.tax.toFixed(2)}\nNet: **$${result.netRevenue.toFixed(2)}**`, inline: true },
                    { name: 'Tax Bracket', value: `**${result.taxLabel}**\nHeld for: ${timeHeldStr}`, inline: true },
                    { name: 'Profit', value: `${profitSign}$${result.profit.abs().toFixed(2)}`, inline: true },
                    { name: 'Price Impact 📉', value: `$${result.oldPrice.toFixed(2)} ➔ $${result.newPrice.toFixed(2)} (-${dropPercent.toFixed(1)}%)`, inline: false }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            errorReply(interaction, error.message || "Transaction failed.");
        }
    },
};

async function errorReply(interaction: ChatInputCommandInteraction, msg: string) {
    const embed = new EmbedBuilder().setColor(Colors.Danger).setDescription(msg);
    if (interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
}