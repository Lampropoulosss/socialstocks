import { Events, VoiceState } from 'discord.js';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.member?.id;
        const guildId = newState.guild.id;

        if (!userId || newState.member?.user.bot) return;

        const shouldTrack = (state: VoiceState) => {
            return (
                state.channelId !== null &&
                !state.selfMute &&
                !state.selfDeaf &&
                !state.serverMute &&
                !state.serverDeaf
            );
        };

        const wasTracking = shouldTrack(oldState);
        const isTracking = shouldTrack(newState);

        if (!wasTracking && isTracking) {
            // Started being eligible (Joined unmuted OR Unmuted/Undeafened)
            voiceService.startTracking(userId, guildId);
        }

        if (wasTracking && !isTracking) {
            // Stopped being eligible (Left OR Muted/Deafened)
            voiceService.stopTracking(userId, guildId);
        }
    },
};
