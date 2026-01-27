import { Events, Message } from 'discord.js';
import prisma from '../prisma';
import redis, { checkMessageFlow } from '../redis'; // Assuming redis is exported from here
import crypto from 'crypto';

module.exports = {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot) return;
        if (!message.guild) return; // Ensure we are in a guild

        const discordId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        // Helper for scoped redis keys (needed for cache updates on jail)
        const getRedisKey = (prefix: string) => `${prefix}:${guildId}:${discordId}`;
        const userCacheKey = getRedisKey('user:registered');
        const msgHistoryKey = getRedisKey('user:msgs'); // Needed for cleanup if manual intervention

        const contentHash = crypto.createHash('sha256').update(message.content.toLowerCase()).digest('hex');

        // Optimization 1: "Nuclear" Lua Script
        // ONE call to Redis for all checks (Jail, Spam, Cooldown, History)
        const result = await checkMessageFlow(guildId, discordId, contentHash, now);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [status, payload] = result as [string, any];

        // 1. Blocked Cases
        if (status === 'JAILED') return; // User is jailed
        if (status === 'DUPLICATE') return; // Spam header/duplicate
        if (status === 'OK' && payload === 'COOLDOWN') return; // Valid message but no reward yet

        // 2. Trigger Jail Case
        if (status === 'TRIGGER_JAIL') {
            // 1. Jail User (24h)
            const jailDurationMs = 24 * 60 * 60 * 1000;
            const releaseDate = new Date(now + jailDurationMs);

            // DB Update
            try {
                await prisma.user.update({
                    where: { discordId_guildId: { discordId, guildId } },
                    data: { jailedUntil: releaseDate }
                });

                // Slash stock
                const user = await prisma.user.findUnique({
                    where: { discordId_guildId: { discordId, guildId } },
                    include: { stock: true }
                });

                if (user && user.stock) {
                    const newPrice = Number(user.stock.currentPrice) * 0.5;
                    await prisma.stock.update({
                        where: { id: user.stock.id },
                        data: { currentPrice: newPrice }
                    });
                }
            } catch (e) {
                console.error("Failed to punish user:", e);
            }

            // Update Cache Manually (Script doesn't update cache val, only reads it)
            // We need to fetch internal ID to cache it properly if it wasn't cached, or just update query.
            // Simplification: Try to get ID from DB or just expire cache so next read refetches?
            // Better: Update if we have partial info, or just expire.
            // Let's Expire the user cache key so next message forces a re-cache (which will catch the DB jail status).
            await redis.del(userCacheKey);

            // Reply
            await message.reply(`🚨 **SEC RAID!** 🚨\n${message.author} has been jailed for market manipulation (spamming). Their stock price has been slashed by 50%.`);

            return;
        }

        // 3. Reward Case (status === 'OK' && payload === 'REWARD')
        // Proceed to Buffer Activity
        // We need to ensure we have the cachedUser/internalId for buffering.

        // Attempt to get cached ID from Redis? The script returns it? No.
        // We need to fetch/ensure user exists.

        let internalUserId: string | null = null;
        const cachedUserStr = await redis.get(userCacheKey);

        if (cachedUserStr) {
            try {
                const c = JSON.parse(cachedUserStr);
                internalUserId = c.id;
            } catch (e) { /* ignore */ }
        }

        if (!internalUserId) {
            // Create/Fetch User (same as before)
            const user = await prisma.user.upsert({
                where: { discordId_guildId: { discordId, guildId } },
                update: {},
                create: {
                    discordId,
                    guildId,
                    username: message.author.username,
                    stock: {
                        create: {
                            symbol: message.author.username.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X') || 'USR',
                            currentPrice: 10.00
                        }
                    }
                },
                select: { id: true, jailedUntil: true }
            });
            internalUserId = user.id;

            // Cache it
            const cacheObj = {
                id: internalUserId,
                jailedUntil: user.jailedUntil ? user.jailedUntil.getTime() : null
            };
            await redis.set(userCacheKey, JSON.stringify(cacheObj), 'EX', 60 * 60 * 24);
        }

        // Optimization 3 handled in service, here we just call bufferActivity
        const { ActivityService } = require('../services/activityService');
        const { ActivityType } = require('@prisma/client');

        await ActivityService.bufferActivity({
            userId: internalUserId,
            type: ActivityType.MESSAGE,
            value: message.content.length,
            metadata: {
                channelId: message.channel.id,
                contentHash: contentHash
            }
        });

        // Return here to avoid falling into old code
        return;



    },
};
