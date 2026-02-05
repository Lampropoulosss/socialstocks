import { GuildMember } from 'discord.js';
import { redisQueue } from '../redis';
import { ActivityService, ActivityType } from './activityService';

class VoiceService {
    async startTracking(member: GuildMember) {
        if (member.user.bot) return;

        const key = `v:s:${member.guild.id}:${member.id}`;
        const metaKey = `v:m:${member.guild.id}:${member.id}`;
        const now = Date.now().toString();

        const pipeline = redisQueue.pipeline();
        pipeline.setnx(key, now);
        pipeline.set(metaKey, member.user.username, 'EX', 86400);
        await pipeline.exec();
    }

    async stopTracking(discordId: string, guildId: string) {
        const key = `v:s:${guildId}:${discordId}`;
        const metaKey = `v:m:${guildId}:${discordId}`;

        const [startStr, username] = await redisQueue.mget(key, metaKey);

        await redisQueue.del(key, metaKey);

        if (!startStr) return;

        const startTimeMs = parseInt(startStr, 10);
        if (isNaN(startTimeMs)) return;

        const durationMinutes = Math.floor((Date.now() - startTimeMs) / 60000);
        if (durationMinutes < 1) return;

        const finalUsername = username || "Unknown";

        const voicePoints = durationMinutes * 2;

        await ActivityService.bufferActivity({
            discordId,
            guildId,
            username: finalUsername,
            type: ActivityType.VOICE_MINUTE,
            value: voicePoints,
        });
    }

    async stopTrackingForGuild(guildId: string) {
        const stream = redisQueue.scanStream({ match: `voice:*:${guildId}:*`, count: 100 });
        stream.on('data', (keys: string[]) => {
            if (keys.length) {
                const pipeline = redisQueue.pipeline();
                keys.forEach(key => pipeline.del(key));
                pipeline.exec();
            }
        });
    }
}

export const voiceService = new VoiceService();