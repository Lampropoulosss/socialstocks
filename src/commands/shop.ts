import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';
import { ItemService } from '../services/itemService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View items available for purchase'),
    async execute(interaction: ChatInputCommandInteraction) {
        const items = ItemService.getItems();

        const embed = new EmbedBuilder()
            .setTitle("🛒 Insider Trading Shop")
            .setColor(Colors.Primary)
            .setDescription("Buy items to manipulate the market or boost your performance.")
            .addFields(
                items.map(item => ({
                    name: `${item.name} - $${item.price}`,
                    value: `${item.description}\n⏳ Duration: ${item.durationMinutes}m | 🕒 Cooldown: ${item.cooldownMinutes}m`
                }))
            )
            .setFooter({ text: "Use /buy_item <item_name> <user> to purchase." });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
