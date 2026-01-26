import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { MarketService } from '../services/marketService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('View top stocks in the market'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const response = await MarketService.getMarketResponse();

        await interaction.editReply(response);
    },
};
