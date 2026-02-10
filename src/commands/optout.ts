import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { Colors } from '../utils/theme';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('optout')
        .setDescription('Delete your account and all associated data permanently.'),
    async execute(interaction: ChatInputCommandInteraction) {
        const confirmId = 'confirm_optout';
        const cancelId = 'cancel_optout';

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Opt Out?')
            .setDescription('Are you sure you want to opt out? **This action cannot be undone.**\n\nAll your stocks, balance, and portfolio will be permanently deleted.')
            .setColor(Colors.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(confirmId)
                    .setLabel('Yes, Opt Out')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(cancelId)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    },
};
