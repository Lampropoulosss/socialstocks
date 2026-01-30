import { Client, Events } from 'discord.js';
import { LeaderboardService } from '../services/leaderboardService';
import { StockService } from '../services/stockService'; // Import top level
import { ActivityService } from '../services/activityService'; // Import top level
import { voiceService } from '../services/voiceService';
import redis from '../redis';

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
        }, 60 * 60 * 1000); // 1 Hour

        setInterval(() => {
            // Using the imported service directly
            StockService.updateAllStocks().catch(console.error);
        }, 10 * 60 * 1000); // 10 mins

        setInterval(() => {
            ActivityService.flushActivities().catch(console.error);
        }, 5 * 1000); // 5 seconds

        // ... rest of the voice cleanup logic (it was good) ...
        // Ensure when you call voiceService.startTracking here, you pass the member object.
        // Since client.guilds...voiceStates only gives VoiceState, you need:

        console.log("Cleaning up ghost sessions...");
        const guilds = client.guilds.cache.values();
        const activeVoiceKeys = new Set<string>();

        for (const guild of guilds) {
            await new Promise(resolve => setImmediate(resolve));
            if (!guild.voiceStates) continue;
            for (const state of guild.voiceStates.cache.values()) {
                if (state.channelId && state.member && !state.member.user.bot) {
                    // Update: pass member
                    voiceService.startTracking(state.member);
                    activeVoiceKeys.add(`voice:start:${guild.id}:${state.member.id}`);
                }
            }
        }
        // ... rest of scan logic ...
    }
};
