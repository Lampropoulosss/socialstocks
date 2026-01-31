import { Events, Guild } from 'discord.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.GuildDelete,
    async execute(guild: Guild) {
        console.log(`Left guild: ${guild.name} (${guild.id}). Cleaning up data...`);

        try {
            const users = await prisma.user.findMany({
                where: { guildId: guild.id },
                select: { id: true }
            });

            const userIds = users.map(u => u.id);

            const result = await prisma.user.deleteMany({
                where: { guildId: guild.id }
            });

            console.log(`Deleted ${result.count} users and related data for guild ${guild.id}`);

            const pipeline = redisCache.pipeline();

            pipeline.del(`leaderboard:networth:${guild.id}`);
            for (const userId of userIds) {
                pipeline.del(`user:${userId}:username`);
            }

            await pipeline.exec();

            voiceService.stopTrackingForGuild(guild.id);

        } catch (error) {
            console.error(`Error cleaning up data for guild ${guild.id}:`, error);
        }
    },
};
