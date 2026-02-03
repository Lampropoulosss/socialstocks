import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { MarketService } from '../services/marketService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('View top stocks in the market'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.guildId) {
            await interaction.editReply('This command can only be used in a server.');
            return;
        }

        const response = await MarketService.getMarketResponse(interaction.guildId);

        await interaction.editReply(response);
    },
};
