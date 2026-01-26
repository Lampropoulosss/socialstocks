import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the richest users on the platform'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        try {
            if (!interaction.guildId) {
                await interaction.editReply("This command can only be used in a server.");
                return;
            }
            const topUsers = await LeaderboardService.getLeaderboard(interaction.guildId, 10);

            if (topUsers.length === 0) {
                await interaction.editReply("The leaderboard is empty. Wait for the next update cycle.");
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆 SocialStocks Leaderboard')
                .setColor('#FFD700')
                .setDescription(topUsers.map(u => `**#${u.rank}** ${u.username} — $${u.netWorth.toFixed(2)}`).join('\n'))
                .setFooter({ text: 'Updates every 5 minutes' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply("Failed to fetch leaderboard.");
        }
    },
};
