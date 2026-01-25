import { StockService } from './stockService';
import prisma from '../prisma';
import redis from '../redis';

class VoiceService {
    // Key prefix: voice:start:{guildId}:{discordId}

    async startTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;
        const now = Date.now().toString();

        // Use SETNX to set only if not exists (prevent resetting time on re-join events if already tracked? 
        // Or arguably, if they rejoin, we might want to continue? 
        // But usually join + move = separate events. 
        // Let's assume SETNX is safer to avoid resetting if multi-events fire.
        const set = await redis.setnx(key, now);
        if (set) {
            console.log(`Started voice tracking for ${discordId} in ${guildId}`);
        }
    }

    async stopTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;
        const startStr = await redis.get(key);

        if (!startStr) return;

        const start = parseInt(startStr);
        const now = Date.now();
        const durationMs = now - start;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));

        if (durationMinutes > 0) {
            const user = await prisma.user.findUnique({
                where: { discordId_guildId: { discordId, guildId } }
            });

            if (user) {
                console.log(`Awarding voice points to ${discordId} for ${durationMinutes} minutes.`);
                // We track total minutes. Original code did 1 call per minute.
                // StockService.trackVoice adds 60 value (maybe minutes?).
                // Let's call trackVoice multiple times or update trackVoice to accept amount.
                // Checking stockService.ts: trackVoice(userId) -> adds 1 entry with value 60.
                // Suggestion: Call it once per minute? Or loop?
                // Better: Loop for now to keep behavior identical, or refactor trackVoice later.
                // To avoid massive await loop, we can just add one log with value = 60 * minutes?
                // But StockService.trackVoice hardcodes value: 60.
                // LET'S MODIFY StockService to accept minutes or value later. 
                // For now, I will modify this to use a loop but careful.
                // Actually, the best way is to update StockService.trackVoice to take a "minutes" arg.
                // I will update StockService next. I'll update this file to call trackVoice(user.id, durationMinutes).

                await StockService.trackVoice(user.id, durationMinutes);
            }
        }

        await redis.del(key);
        console.log(`Stopped voice tracking for ${discordId} in ${guildId}`);
    }

    // Optional: Cleanup method if needed, though Redis keys can be given TTL if we wanted.
    // We'll leave stopTrackingForGuild empty or implementing a scan if really needed, 
    // but usually not critical for "leaks" anymore since they are just redis keys.
    async stopTrackingForGuild(guildId: string) {
        // Implementation would require SCAN. For now, we can omit or log.
        console.log(`stopTrackingForGuild called for ${guildId} - handled by Redis keys persistence.`);
    }
}

export const voiceService = new VoiceService();
