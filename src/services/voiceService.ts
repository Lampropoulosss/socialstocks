import { GuildMember } from 'discord.js';
import { redisQueue } from '../redis';
import { ActivityService, ActivityType } from './activityService';

class VoiceService {
    // Added username parameter
    async startTracking(member: GuildMember) {
        if (member.user.bot) return;

        const key = `v:s:${member.guild.id}:${member.id}`;
        const metaKey = `v:m:${member.guild.id}:${member.id}`;
        const now = Date.now().toString();

        // Use a transaction (pipeline) to set start time AND cache username
        const pipeline = redisQueue.pipeline();
        pipeline.setnx(key, now);
        // Cache username for 24h just in case, to ensure we have it when they leave
        pipeline.set(metaKey, member.user.username, 'EX', 86400);
        await pipeline.exec();
    }

    async stopTracking(discordId: string, guildId: string) {
        const key = `v:s:${guildId}:${discordId}`;
        const metaKey = `v:m:${guildId}:${discordId}`;

        // Fetch start time and username in one go
        const [startStr, username] = await redisQueue.mget(key, metaKey);

        // Cleanup immediately
        await redisQueue.del(key, metaKey);

        if (!startStr) return;

        const startTimeMs = parseInt(startStr, 10);
        if (isNaN(startTimeMs)) return;

        const durationMinutes = Math.floor((Date.now() - startTimeMs) / 60000);
        if (durationMinutes < 1) return;

        // Use cached username, or fallback to "Unknown" (which will trigger a DB fetch in ActivityService if logic allows)
        // Ideally, ActivityService should look up the user if username is "Unknown"
        const finalUsername = username || "Unknown";

        await ActivityService.bufferActivity({
            discordId,
            guildId,
            username: finalUsername,
            type: ActivityType.VOICE_MINUTE,
            value: durationMinutes * 2, // 2 points per minute
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
