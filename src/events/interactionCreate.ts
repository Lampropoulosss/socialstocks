import { Events, Interaction, MessageFlags, DiscordAPIError } from 'discord.js';
import { ProfileService } from '../services/profileService';
import { MarketService } from '../services/marketService';
import { LeaderboardService } from '../services/leaderboardService';
import { HelpService } from '../services/helpService';

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        if (interaction.isChatInputCommand()) {
            const client = interaction.client;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const command = (client as any).commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                if (error instanceof DiscordAPIError && error.code === 10062) {
                    console.warn(`Interaction ${interaction.commandName} timed out before reply.`);
                    return;
                }
                console.error(error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
                    }
                } catch (replyError) { }
            }
            return;
        }

        if (interaction.isButton()) {
            const { customId, guildId } = interaction;
            const userId = interaction.user.id;
            const username = interaction.user.username;

            if (!guildId) {
                await interaction.reply({ content: 'This action can only be performed in a server.', flags: MessageFlags.Ephemeral });
                return;
            }

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate();
                }

                // --- PAGINATION HANDLER ---
                if (customId.startsWith('market_page_')) {
                    // Extract page number from "market_page_2"
                    const page = parseInt(customId.split('_')[2]) || 1;
                    const response = await MarketService.getMarketResponse(guildId, page);
                    await interaction.editReply(response);
                    return;
                }

                if (customId === 'refresh_profile') {
                    const response = await ProfileService.getProfileResponse(userId, guildId, username);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.followUp({ content: 'Profile not found or not initialized yet.', flags: MessageFlags.Ephemeral });
                    }
                }
                else if (customId === 'refresh_leaderboard') {
                    const response = await LeaderboardService.getLeaderboardResponse(guildId);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.editReply({ content: 'Leaderboard is currently empty.', embeds: [], components: [] });
                    }
                }
                else if (customId === 'view_help') {
                    const response = HelpService.getHelpResponse();
                    await interaction.editReply(response);
                }
                else if (customId === 'confirm_optout') {
                    const success = await ProfileService.deleteUserProfile(userId, guildId);
                    if (success) {
                        await interaction.editReply({
                            content: '✅ Your data has been successfully deleted.',
                            embeds: [],
                            components: []
                        });
                    } else {
                        await interaction.editReply({
                            content: '❌ An error occurred while deleting your data. Please try again later.',
                            embeds: [],
                            components: []
                        });
                    }
                }
                else if (customId === 'cancel_optout') {
                    await interaction.editReply({
                        content: 'Action cancelled.',
                        embeds: [],
                        components: []
                    });
                }
            } catch (error) {
                console.error("Button interaction error:", error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'Interaction failed due to an error.', flags: MessageFlags.Ephemeral });
                    }
                } catch (replyError) {
                    console.error('Error sending button error message:', replyError);
                }
            }
        }
    },
};