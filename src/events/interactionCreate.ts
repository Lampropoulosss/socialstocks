import { Events, Interaction } from 'discord.js';
import { ProfileService } from '../services/profileService';
import { MarketService } from '../services/marketService';
import { LeaderboardService } from '../services/leaderboardService';
import { HelpService } from '../services/helpService';

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        if (interaction.isChatInputCommand()) {
            const client = interaction.client;
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
            return;
        }

        if (interaction.isButton()) {
            const { customId, guildId } = interaction;
            const userId = interaction.user.id;
            const username = interaction.user.username;

            if (!guildId) {
                await interaction.reply({ content: 'This action can only be performed in a server.', ephemeral: true });
                return;
            }

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate();
                }

                if (customId === 'refresh_profile') {
                    const response = await ProfileService.getProfileResponse(userId, guildId, username);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.followUp({ content: 'Profile not found or not initialized yet.', ephemeral: true });
                    }
                } else if (customId === 'refresh_market') {
                    const response = await MarketService.getMarketResponse();
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.followUp({ content: 'Market data unavailable.', ephemeral: true });
                    }
                } else if (customId === 'refresh_leaderboard') {
                    const response = await LeaderboardService.getLeaderboardResponse(guildId);
                    if (response) {
                        await interaction.editReply(response);
                    } else {
                        await interaction.editReply({ content: 'Leaderboard is currently empty.', embeds: [], components: [] });
                    }
                } else if (customId === 'view_help') {
                    const response = HelpService.getHelpResponse();
                    await interaction.editReply(response);
                }
            } catch (error) {
                console.error("Button interaction error:", error);
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: 'Interaction failed due to an error.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'Interaction failed.', ephemeral: true });
                }
            }
        }
    },
};
