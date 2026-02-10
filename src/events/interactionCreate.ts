import { Events, Interaction, MessageFlags, DiscordAPIError, EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/theme';
import { ProfileService } from '../services/profileService';
import { MarketService } from '../services/marketService';
import { LeaderboardService } from '../services/leaderboardService';
import { HelpService } from '../services/helpService';

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        if (interaction.isChatInputCommand()) {
            if (!interaction.guildId) return;

            // --- 1. OPT-OUT CHECK FOR COMMANDS ---
            // Check opt-out status first
            const isOptedOut = await ProfileService.isUserOptedOut(interaction.user.id, interaction.guildId);

            // Allow them to run 'optin' (you should create this command) or 'optout' (to see status)
            // Block everything else
            if (isOptedOut && interaction.commandName !== 'optin') {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Danger)
                    .setTitle("🚫 Account Opted Out")
                    .setDescription("You have opted out of the bot system. Your data is preserved, but you cannot interact with the economy or gain XP.\n\nUse `/optin` to reactivate your account.");

                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

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
                // Check opt-out for buttons too
                const isOptedOut = await ProfileService.isUserOptedOut(userId, guildId);
                if (isOptedOut && customId !== 'confirm_optout' && customId !== 'cancel_optout') {
                    await interaction.reply({ content: 'You are opted out. Use /optin to restore functionality.', flags: MessageFlags.Ephemeral });
                    return;
                }

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
                    // CHANGED: Instead of deleteUserProfile, we use setOptOutStatus
                    const success = await ProfileService.setOptOutStatus(userId, guildId, true);
                    if (success) {
                        await interaction.editReply({
                            content: '✅ You have successfully **opted out**. The bot will now ignore your messages and voice activity. You can use `/optin` to reactivate your account.',
                            embeds: [],
                            components: []
                        });
                    } else {
                        await interaction.editReply({
                            content: '❌ An error occurred. Please try again later.',
                            embeds: [],
                            components: []
                        });
                    }
                }
                else if (customId === 'cancel_optout') {
                    await interaction.editReply({
                        content: 'Opt-out cancelled.',
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