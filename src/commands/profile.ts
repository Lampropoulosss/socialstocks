import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ProfileService } from '../services/profileService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your stock profile and balance'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const discordId = interaction.user.id;
        const guildId = interaction.guildId!;
        const username = interaction.user.username;

        const response = await ProfileService.getProfileResponse(discordId, guildId, username);

        if (!response) {
            await interaction.editReply("You don't have a profile yet. Start chatting to generate one!");
            return;
        }

        await interaction.editReply(response);
    },
};
