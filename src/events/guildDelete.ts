import { Events, Guild } from 'discord.js';
import prisma from '../prisma';
import redis from '../redis';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.GuildDelete,
    async execute(guild: Guild) {
        console.log(`Left guild: ${guild.name} (${guild.id}). Cleaning up data...`);

        try {
            // 1. Delete all users associated with this guild
            // We first need to find them to get their IDs for Redis cleanup
            const users = await prisma.user.findMany({
                where: { guildId: guild.id },
                select: { id: true }
            });

            const userIds = users.map(u => u.id);

            // Delete from DB (Cascade handles relations)
            const result = await prisma.user.deleteMany({
                where: { guildId: guild.id }
            });

            console.log(`Deleted ${result.count} users and related data for guild ${guild.id}`);

            // 2. Clean up Redis
            const pipeline = redis.pipeline();

            // Leaderboard
            pipeline.del(`leaderboard:networth:${guild.id}`);

            // Usernames (This might be a lot of keys, but necessary if we want to be clean)
            for (const userId of userIds) {
                pipeline.del(`user:${userId}:username`);
            }

            await pipeline.exec();

            // 3. Stop Voice Tracking
            voiceService.stopTrackingForGuild(guild.id);

            // Note: Other Redis keys (timeouts, rate limits) are short-lived or will naturally expire.

        } catch (error) {
            console.error(`Error cleaning up data for guild ${guild.id}:`, error);
        }
    },
};
