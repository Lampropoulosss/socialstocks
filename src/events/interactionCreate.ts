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

            const isOptedOut = await ProfileService.isUserOptedOut(interaction.user.id, interaction.guildId);

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
                const isOptedOut = await ProfileService.isUserOptedOut(userId, guildId);
                if (isOptedOut && customId !== 'confirm_optout' && customId !== 'cancel_optout') {
                    await interaction.reply({ content: 'You are opted out. Use /optin to restore functionality.', flags: MessageFlags.Ephemeral });
                    return;
                }

                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate();
                }

                if (customId.startsWith('market_page_')) {
                    const page = parseInt(customId.split('_')[2]) || 1;
                    const response = await MarketService.getMarketResponse(guildId, page);
                    await interaction.editReply(response);
                    return;
                }

                if (customId.startsWith('leaderboard_page_')) {
                    const page = parseInt(customId.split('_')[2]) || 1;
                    const response = await LeaderboardService.getLeaderboardResponse(guildId, page);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.editReply({ content: 'Leaderboard page unavailable.', embeds: [], components: [] });
                    }
                    return;
                }

                if (customId.startsWith('profile_page_')) {
                    const parts = customId.split('_');
                    const targetUserId = parts[2];
                    const page = parseInt(parts[3]) || 1;

                    // If viewing own profile, use current username, otherwise fallback to generic
                    const targetUsername = targetUserId === userId ? username : 'User';

                    const response = await ProfileService.getProfileResponse(targetUserId, guildId, targetUsername, userId, page);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.editReply({ content: 'Profile not found.', components: [] });
                    }
                    return;
                }

                switch (customId) {
                    case 'refresh_profile': {
                        const response = await ProfileService.getProfileResponse(userId, guildId, username, userId, 1);
                        if (response) {
                            await interaction.editReply(response);
                        } else {
                            await interaction.followUp({ content: 'Profile not found or not initialized yet.', flags: MessageFlags.Ephemeral });
                        }
                        break;
                    }
                    case 'refresh_leaderboard': {
                        const response = await LeaderboardService.getLeaderboardResponse(guildId, 1);
                        if (response) {
                            await interaction.editReply(response);
                        } else {
                            await interaction.editReply({ content: 'Leaderboard is currently empty.', embeds: [], components: [] });
                        }
                        break;
                    }
                    case 'view_help': {
                        const response = HelpService.getHelpResponse();
                        await interaction.editReply(response);
                        break;
                    }
                    case 'confirm_optout': {
                        const success = await ProfileService.setOptOutStatus(userId, guildId, true);
                        if (success) {
                            await interaction.editReply({
                                content: '✅ You have successfully **opted out**. The bot will now ignore your messages and voice activity. Use `/optin` to reactivate.',
                                embeds: [],
                                components: []
                            });
                        } else {
                            await interaction.editReply({ content: '❌ An error occurred. Please try again later.', embeds: [], components: [] });
                        }
                        break;
                    }
                    case 'cancel_optout': {
                        await interaction.editReply({ content: 'Opt-out cancelled.', embeds: [], components: [] });
                        break;
                    }
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