import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the richest users on the platform'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            if (!interaction.guildId) {
                await interaction.editReply("This command can only be used in a server.");
                return;
            }

            const response = await LeaderboardService.getLeaderboardResponse(interaction.guildId);

            if (!response) {
                await interaction.editReply("The leaderboard is empty. Wait for the next update cycle.");
                return;
            }

            await interaction.editReply(response);

        } catch (error) {
            console.error(error);
            await interaction.editReply("Failed to fetch leaderboard.");
        }
    },
};
