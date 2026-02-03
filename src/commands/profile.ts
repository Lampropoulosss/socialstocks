import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ProfileService } from '../services/profileService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your stock profile and balance')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose profile you want to view')
                .setRequired(false)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const discordId = targetUser.id;
        const guildId = interaction.guildId!;
        const username = targetUser.username;

        const response = await ProfileService.getProfileResponse(discordId, guildId, username);

        if (!response) {
            const message = targetUser.id === interaction.user.id
                ? "You don't have a profile yet. Start chatting to generate one!"
                : `${username} doesn't have a profile yet.`;
            await interaction.editReply(message);
            return;
        }

        await interaction.editReply(response);
    },
};
