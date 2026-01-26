import { StockService } from './stockService';
import prisma from '../prisma';
import redis from '../redis';

class VoiceService {
    // Key prefix: voice:start:{guildId}:{discordId}

    async startTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;
        const now = Date.now().toString();

        // 1. Set in Redis (Fast access)
        const set = await redis.setnx(key, now);

        // 2. persist to DB
        // Find user to get internal ID
        const user = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId, guildId } }
        });

        if (user) {
            // Check if there is already an open session, close it if so
            const existingSession = await prisma.voiceSession.findFirst({
                where: {
                    userId: user.id,
                    guildId: guildId,
                    endTime: null
                }
            });

            if (existingSession) {
                // Close it to be safe (maybe crashed before?)
                await prisma.voiceSession.update({
                    where: { id: existingSession.id },
                    data: { endTime: new Date() }
                });
            }

            // Create new session
            await prisma.voiceSession.create({
                data: {
                    userId: user.id,
                    guildId,
                    startTime: new Date()
                }
            });
        }

        if (set && user) {
            console.log(`Started voice tracking for ${discordId} in ${guildId}`);
        }
    }

    async stopTracking(discordId: string, guildId: string) {
        const key = `voice:start:${guildId}:${discordId}`;

        // 1. Check Redis First
        const startStr = await redis.get(key);
        let startTimeMs: number | null = startStr ? parseInt(startStr) : null;
        let dbSessionId: string | null = null;

        // 2. Check DB (Fallback & Authority)
        const user = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId, guildId } }
        });

        if (!user) {
            // If user doesn't exist, we can't track/reward. Just clean redis.
            await redis.del(key);
            return;
        }

        const openSession = await prisma.voiceSession.findFirst({
            where: {
                userId: user.id,
                guildId: guildId,
                endTime: null
            },
            orderBy: { startTime: 'desc' }
        });

        if (openSession) {
            dbSessionId = openSession.id;
            // If we didn't have start time from Redis, use DB
            if (!startTimeMs) {
                startTimeMs = openSession.startTime.getTime();
            }
        }

        // If no start time found in either, nothing to do
        if (!startTimeMs && !openSession) {
            return;
        }

        const now = Date.now();
        const durationMs = now - (startTimeMs || now); // Should not happen if logic holds
        const durationMinutes = Math.floor(durationMs / (1000 * 60));

        // 3. Persist/Update DB
        if (dbSessionId) {
            await prisma.voiceSession.update({
                where: { id: dbSessionId },
                data: { endTime: new Date() }
            });
        } else if (startTimeMs) {
            // Edge case: In Redis but not DB (DB write failed at start?)
            // Record the finished session now.
            await prisma.voiceSession.create({
                data: {
                    userId: user.id,
                    guildId,
                    startTime: new Date(startTimeMs),
                    endTime: new Date()
                }
            });
        }

        // 4. Award Points
        if (durationMinutes > 0) {
            console.log(`Awarding voice points to ${discordId} for ${durationMinutes} minutes.`);
            await StockService.trackVoice(user.id, durationMinutes);
        }

        // 5. Cleanup Redis
        await redis.del(key);
        console.log(`Stopped voice tracking for ${discordId} in ${guildId}`);
    }

    // Optional: Cleanup method if needed
    async stopTrackingForGuild(guildId: string) {
        console.log(`stopTrackingForGuild called for ${guildId} - handled by DB/Redis persistence logic.`);
    }
}

export const voiceService = new VoiceService();
