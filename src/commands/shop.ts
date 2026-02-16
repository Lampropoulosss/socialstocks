import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';
import { ItemService } from '../services/itemService';
import prisma from '../prisma';
import Decimal from 'decimal.js';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View items available for purchase'),
    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;
        const items = ItemService.getItems();

        const user = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: userId, guildId } },
            select: { netWorth: true }
        });

        const userNetWorth = user
            ? new Decimal(user.netWorth.toString())
            : new Decimal(0);

        const embed = new EmbedBuilder()
            .setTitle("🛒 Insider Trading Shop")
            .setColor(Colors.Primary)
            .setDescription(`Items have a **Base Price**. \nIf you are wealthy, items cost a **% of your Net Worth** instead.\n\nYour Net Worth: **$${userNetWorth.toNumber().toLocaleString()}**`)
            .addFields(
                items.map(item => {
                    const dynamicCost = ItemService.calculateItemCost(item, userNetWorth);
                    const isScaled = dynamicCost > item.basePrice;

                    return {
                        name: `${item.name}`,
                        value: `**Price:** $${dynamicCost.toLocaleString()} ${isScaled ? ' ' : ''}\n` +
                            `${isScaled ? `*(Taxed at ${item.wealthPercent * 100}% of NW)*` : `*(Base Price)*`}\n` +
                            `${item.description}\n` +
                            `⏳ ${item.durationMinutes}m | 🕒 Cool: ${item.cooldownMinutes}m`
                    };
                })
            )
            .setFooter({ text: "Use /buy_item <item_name> <user> to purchase." });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};