import { Events, VoiceState } from 'discord.js';
import { voiceService } from '../services/voiceService';



module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.member?.id;
        const guildId = newState.guild.id;

        if (!userId || newState.member?.user.bot) return;

        // User joined a channel
        if (!oldState.channelId && newState.channelId) {
            voiceService.startTracking(userId, guildId);
        }

        // User left a channel
        if (oldState.channelId && !newState.channelId) {
            voiceService.stopTracking(userId, guildId);
        }
    },
};
