import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { MarketService } from '../services/marketService';
import { Colors } from '../utils/theme';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('View top stocks in the market'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guildId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("🚫 This command can only be used in a server.");
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const response = await MarketService.getMarketResponse(interaction.guildId);

        await interaction.editReply(response);
    },
};
