import { Client, Events } from 'discord.js';
import { voiceService } from '../services/voiceService';
import { updateBotStats } from '../utils/updateStats';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag} (Shard ${client.shard?.ids[0] ?? 0})`);

        updateBotStats(client);

        console.log("Cleaning up ghost sessions...");
        const guilds = client.guilds.cache.values();

        for (const guild of guilds) {
            await new Promise(resolve => setImmediate(resolve));
            if (!guild.voiceStates) continue;
            for (const state of guild.voiceStates.cache.values()) {
                if (state.channelId && state.member && !state.member.user.bot) {
                    voiceService.startTracking(state.member);
                }
            }
        }
    }
};