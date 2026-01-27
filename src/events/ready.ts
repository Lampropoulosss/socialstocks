import { Client, Events } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);

        // Initial Syncs
        LeaderboardService.syncLeaderboard().catch(console.error);

        // Intervals
        setInterval(() => {
            LeaderboardService.syncLeaderboard().catch(console.error);
        }, 60 * 60 * 1000);

        // Decay (every 10 mins is fine, or hourly)
        setInterval(() => {
            import('../services/stockService').then(({ StockService }) => {
                StockService.updateAllStocks().catch(console.error);
            });
        }, 10 * 60 * 1000);

        // Activity Flush (Keep this fast, e.g., 5s or 10s is better than 30s for responsiveness)
        setInterval(() => {
            import('../services/activityService').then(({ ActivityService }) => {
                ActivityService.flushActivities().catch(console.error);
            });
        }, 5 * 1000);

        // Non-Blocking Voice Scan
        console.log("Scanning for active voice users...");

        const guilds = client.guilds.cache.values();
        for (const guild of guilds) {
            // CRITICAL: Yield to event loop to prevent freezing cpu
            await new Promise(resolve => setImmediate(resolve));

            if (!guild.voiceStates) continue;

            for (const state of guild.voiceStates.cache.values()) {
                // Use state.id (Discord ID), not state.member (which might be null if invisible)
                if (state.channelId && state.id && !state.member?.user.bot) {
                    voiceService.startTracking(state.id, guild.id);
                }
            }
        }
        console.log("Voice scan complete.");
    },
};
