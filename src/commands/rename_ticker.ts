import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import prisma from '../prisma';
import { ShareholderService } from '../services/shareholderService';
import { escapeMarkdown } from '../utils/markdownUtils';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rename_ticker')
        .setDescription('Rename the stock ticker of a user (Majority Shareholder only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose ticker you want to change')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('new_ticker')
                .setDescription('The new ticker name (3-5 chars)')
                .setMinLength(3)
                .setMaxLength(5)
                .setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const targetUserOption = interaction.options.getUser('user')!;
        const newTicker = interaction.options.getString('new_ticker')!.toUpperCase();
        const buyerId = interaction.user.id;
        const guildId = interaction.guildId!;

        // 1. Validation
        if (!/^[A-Z0-9]+$/.test(newTicker)) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 Ticker must only contain alphanumeric characters.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const buyer = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: buyerId, guildId } }
        });

        if (!buyer) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You need a profile.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const targetUserDb = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: targetUserOption.id, guildId } },
            include: { stock: true }
        });

        if (!targetUserDb || !targetUserDb.stock) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 Target user has no stock.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // 2. Check Majority Shareholder
        const majority = await ShareholderService.getMajorityShareholder(targetUserDb.stock.id);

        if (!majority || majority.discordId !== buyerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 You are not the Majority Shareholder of this stock.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // 3. Fee
        const RENAME_FEE = 500;
        if (buyer.balance.toNumber() < RENAME_FEE) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription(`🚫 Insufficient funds. Renaming costs $${RENAME_FEE}.`);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // 4. Execution
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: buyer.id },
                data: { balance: { decrement: RENAME_FEE } }
            });

            await tx.stock.update({
                where: { id: targetUserDb.stock!.id },
                data: { symbol: newTicker }
            });
        });

        const embed = new EmbedBuilder()
            .setColor(Colors.Success)
            .setTitle("✅ Ticker Renamed")
            .setDescription(`**${escapeMarkdown(targetUserOption.username)}**'s stock is now traded as **${newTicker}**.`)
            .setFooter({ text: `Paid by Majority Shareholder ${interaction.user.username}` });

        await interaction.editReply({ embeds: [embed] });
    },
};
