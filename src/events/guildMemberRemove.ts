import { Events, GuildMember } from 'discord.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member: GuildMember) {
        if (member.user.bot) return;

        console.log(`User left: ${member.user.tag} (${member.id}). Cleaning up...`);

        try {
            await voiceService.stopTracking(member.id, member.guild.id);

            const deletedUser = await prisma.user.delete({
                where: {
                    discordId_guildId: {
                        discordId: member.id,
                        guildId: member.guild.id
                    }
                }
            });

            const pipeline = redisCache.pipeline();

            pipeline.zrem(`leaderboard:networth:${member.guild.id}`, deletedUser.id);

            pipeline.del(`user:${deletedUser.id}:username`);

            await pipeline.exec();

        } catch (error) {
            if ((error as any).code === 'P2025') return;
            console.error(`Error cleaning up user ${member.id}:`, error);
        }
    },
};