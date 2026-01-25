import { Client, Events } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);

        // Initial Leaderboard Sync
        console.log("Running initial leaderboard sync...");
        try {
            await LeaderboardService.syncLeaderboard();
        } catch (err) {
            console.error("Failed to sync leaderboard:", err);
        }

        // Schedule sync every 1 hour (Fallback)
        setInterval(() => {
            LeaderboardService.syncLeaderboard().catch((err: unknown) => console.error("Leaderboard sync failed:", err));
        }, 60 * 60 * 1000);

        // Schedule stock price updates every 10 minutes
        setInterval(() => {
            import('../services/stockService').then(({ StockService }) => {
                StockService.updateAllStocks().catch(err => console.error("Stock update failed:", err));
            });
        }, 10 * 60 * 1000);

        // Scan for voice states
        console.log("Scanning for active voice users...");
        for (const guild of client.guilds.cache.values()) {
            for (const state of guild.voiceStates.cache.values()) {
                if (state.channelId && state.member && !state.member.user.bot) {
                    voiceService.startTracking(state.member.id, guild.id);
                }
            }
        }
    },
};
