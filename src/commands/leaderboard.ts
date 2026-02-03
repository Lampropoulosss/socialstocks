import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';
import { Colors } from '../utils/theme';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the richest users on the platform'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!interaction.guildId) {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Danger)
                    .setDescription("🚫 This command can only be used in a server.");
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const response = await LeaderboardService.getLeaderboardResponse(interaction.guildId);

            if (!response) {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Warning)
                    .setTitle("🏆 Leaderboard")
                    .setDescription("The leaderboard is empty. Wait for the next update cycle.");
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            await interaction.editReply(response);

        } catch (error) {
            console.error(error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setTitle("❌ Error")
                .setDescription("Failed to fetch leaderboard.");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
