// src/events/ready.ts
import { Client, Events } from 'discord.js';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag} (Shard ${client.shard?.ids[0] ?? 0})`);

        // Keep Voice Cleanup (This is local to the shard's cache)
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