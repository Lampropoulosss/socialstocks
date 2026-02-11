import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import { ItemService, ItemType } from '../services/itemService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy_item')
        .setDescription('Buy an item from the shop')
        .addStringOption(option =>
            option.setName('item_id')
                .setDescription('The ID of the item to buy')
                .setRequired(true)
                .addChoices(
                    { name: 'The Bullhorn', value: ItemType.BULLHORN },
                    { name: 'Night Shield', value: ItemType.PRICE_FREEZE },
                    { name: 'Rumor Mill', value: ItemType.RUMOR_MILL },
                    { name: 'Liquid Luck', value: ItemType.LIQUID_LUCK }
                ))
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user or stock owner to apply the item to')
                .setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const itemId = interaction.options.getString('item_id') as ItemType;
        const targetUser = interaction.options.getUser('target')!;
        const buyerId = interaction.user.id;
        const guildId = interaction.guildId!;

        try {
            const result = await ItemService.buyItem(buyerId, guildId, itemId, targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("✅ Purchase Successful")
                .setDescription(`Used **${result.itemName}** on **${result.targetName}**.`)
                .addFields(
                    { name: 'Cost', value: `$${result.price}`, inline: true },
                    { name: 'Duration', value: `${result.duration} mins`, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setTitle("❌ Purchase Failed")
                .setDescription(error.message || "An error occurred.");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
