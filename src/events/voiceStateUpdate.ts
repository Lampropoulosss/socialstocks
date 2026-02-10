import { Events, VoiceState } from 'discord.js';
import { voiceService } from '../services/voiceService';
import { ProfileService } from '../services/profileService';

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const member = newState.member;
        if (!member || member.user.bot) return;

        // --- ADDED: Opt-out check ---
        const isOptedOut = await ProfileService.isUserOptedOut(member.id, member.guild.id);
        if (isOptedOut) {
            // Ensure we aren't tracking them if they just opted out while in VC
            voiceService.stopTracking(member.id, member.guild.id);
            return;
        }

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
            voiceService.startTracking(member);
        }

        if (wasTracking && !isTracking) {
            voiceService.stopTracking(member.id, member.guild.id);
        }
    },
};
