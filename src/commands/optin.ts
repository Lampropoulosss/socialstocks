import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';
import { ProfileService } from '../services/profileService';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('optin')
        .setDescription('Reactivate your account and resume tracking.'),
    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = interaction.guildId!;
        const userId = interaction.user.id;

        const isOptedOut = await ProfileService.isUserOptedOut(userId, guildId);

        if (!isOptedOut) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setDescription("You are already active! No need to opt in.");
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return;
        }

        const success = await ProfileService.setOptOutStatus(userId, guildId, false);

        if (success) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Success)
                .setTitle("👋 Welcome Back!")
                .setDescription("Your account has been reactivated. You can now participate in the economy again, and tracking has resumed.");
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
            const embed = new EmbedBuilder()
                .setColor(Colors.Danger)
                .setDescription("Failed to reactivate account. Please try again.");
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
};
