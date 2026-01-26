import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { HelpService } from '../services/helpService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List all available commands'),
    async execute(interaction: ChatInputCommandInteraction) {
        const response = HelpService.getHelpResponse();
        await interaction.reply(response);
    },
};
