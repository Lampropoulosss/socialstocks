import { StockService } from './stockService';
import prisma from '../prisma';
import redis from '../redis';

class VoiceService {
    // Key prefix: voice:start:{guildId}:{discordId}

    // O(1) - No DB connection at all
    async startTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;
        const now = Date.now().toString();
        // Only write to Redis. 
        // We don't care if they are in the DB yet. We will check that on stopTracking.
        const set = await redis.setnx(key, now);

        if (set) {
            console.log(`Started voice tracking for ${discordId} in ${guildId} (Redis-only)`);
        }
    }

    async stopTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;
        const startStr = await redis.get(key);
        if (!startStr) return;

        const startTimeMs = parseInt(startStr);
        const durationMinutes = Math.floor((Date.now() - startTimeMs) / 60000);

        await redis.del(key);

        if (durationMinutes < 1) return;

        // OPTIMIZATION: Do NOT query Prisma here. 
        // Push the raw Discord ID to the buffer.
        const { ActivityService } = require('./activityService');
        await ActivityService.bufferActivity({
            discordId,   // Pass Discord ID
            guildId,     // Pass Guild ID
            username: "Unknown", // We don't need it for updates
            type: "VOICE_MINUTE", // Use string literal or import ActivityType if available, or force cast
            value: durationMinutes * 2, // Pre-calculate score or minutes (User code suggested minutes * 2, let's stick to simple minutes if logic is elsewhere, but request says value: durationMinutes * 2)
        });
    }

    // Optional: Cleanup method if needed
    async stopTrackingForGuild(guildId: string) {
        console.log(`stopTrackingForGuild called for ${guildId} - handled by DB/Redis persistence logic.`);
    }
}

export const voiceService = new VoiceService();
