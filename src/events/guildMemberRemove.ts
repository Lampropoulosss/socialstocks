import { Events, GuildMember } from 'discord.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { voiceService } from '../services/voiceService';

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member: GuildMember) {
        if (member.user.bot) return;

        const userId = member.id;
        const guildId = member.guild.id;

        // 1. Immediate Cache Cleanup (Fastest operations first)
        // Stop voice tracking immediately to prevent ghost sessions
        voiceService.stopTracking(userId, guildId).catch(console.error);

        try {
            // 2. Fetch Data
            const user = await prisma.user.findUnique({
                where: { discordId_guildId: { discordId: userId, guildId } },
                select: { id: true, username: true, stock: { select: { id: true, currentPrice: true } } }
            });

            if (!user) return;

            console.log(`User left: ${user.username} (${userId}). Liquidating assets...`);

            // 3. Transactional Liquidation & Deletion
            await prisma.$transaction(async (tx) => {
                // A. LIQUIDATE INVESTORS (Bulk Update)
                if (user.stock) {
                    await tx.$executeRaw`
                        UPDATE "User" u
                        SET balance = balance + (p.shares * ${user.stock.currentPrice}::numeric), 
                            "updatedAt" = NOW()
                        FROM "Portfolio" p
                        WHERE p."ownerId" = u.id
                        AND p."stockId" = ${user.stock.id}
                        AND p."ownerId" != ${user.id}
                        AND p.shares > 0
                    `;
                }

                await tx.user.delete({
                    where: { id: user.id }
                });
            });

            // 4. Cleanup Redis Keys
            const pipeline = redisCache.pipeline();
            pipeline.zrem(`leaderboard:networth:${guildId}`, user.id);
            pipeline.del(`user:${user.id}:username`);
            pipeline.del(`optout:${guildId}:${userId}`);
            await pipeline.exec();

            console.log(`Cleanup complete for ${user.username}.`);

        } catch (error) {
            if ((error as any).code === 'P2025') return;
            console.error(`Error cleaning up user ${userId}:`, error);
        }
    },
};