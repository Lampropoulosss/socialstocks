import { Events, Message } from 'discord.js';
import prisma from '../prisma';
import redis from '../redis'; // Assuming redis is exported from here
import crypto from 'crypto';

module.exports = {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot) return;
        if (!message.guild) return; // Ensure we are in a guild

        const discordId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        // Helper for scoped redis keys
        const getRedisKey = (prefix: string) => `${prefix}:${guildId}:${discordId}`;

        // --- 1. Jail Check (Unified Cache) ---
        const userCacheKey = getRedisKey('user:registered');
        const cachedUserStr = await redis.get(userCacheKey);

        let cachedUser: { id: string, jailedUntil: number | null } | null = null;

        if (cachedUserStr) {
            try {
                // Try parsing as JSON (new format)
                cachedUser = JSON.parse(cachedUserStr);
            } catch (e) {
                // Backward compatibility: If it's just a string (ID), treat as non-jailed
                cachedUser = { id: cachedUserStr, jailedUntil: null };
            }
        }

        if (cachedUser && cachedUser.jailedUntil && cachedUser.jailedUntil > now) {
            return; // User is Jailed
        }


        // --- 2. Filter A: Low Effort ---
        if (message.content.length < 5) return;


        // --- 3. The "Nuclear Option" (Burst Detection) ---
        const msgHistoryKey = getRedisKey('user:msgs');
        // Push current timestamp to list
        await redis.rpush(msgHistoryKey, now);
        // Keep only last 10
        await redis.ltrim(msgHistoryKey, -10, -1);
        // Set expiry (1 hour is plenty for burst detection)
        await redis.expire(msgHistoryKey, 60 * 60);

        // Get the list
        const timestamps = await redis.lrange(msgHistoryKey, 0, -1);

        if (timestamps.length >= 10) {
            const firstMsgTime = parseInt(timestamps[0]);
            const lastMsgTime = parseInt(timestamps[timestamps.length - 1]);

            if (lastMsgTime - firstMsgTime < 3000) {
                // TRIGGER PUNISHMENT

                // 1. Jail User (24h)
                // 1. Jail User (24h)
                const jailDurationMs = 24 * 60 * 60 * 1000;
                const releaseDate = new Date(Date.now() + jailDurationMs);

                // Update DB
                await prisma.user.update({
                    where: { discordId_guildId: { discordId, guildId } },
                    data: { jailedUntil: releaseDate }
                });

                // Update Cache
                if (cachedUser) {
                    cachedUser.jailedUntil = releaseDate.getTime();
                    await redis.set(userCacheKey, JSON.stringify(cachedUser), 'EX', 60 * 60 * 24);
                } else {
                    // Should be cached if we are here (from msg flow), but if not, ignore or refetch?
                    // Safe to just set redis key for "jail" fallback? No, we moved away from that.
                    // We rely on userCache.
                }

                // 2. Slash stock price by 50%
                try {
                    // Update DB directly
                    const user = await prisma.user.findUnique({
                        where: {
                            discordId_guildId: {
                                discordId: discordId,
                                guildId: guildId
                            }
                        },
                        include: { stock: true }
                    });

                    if (user && user.stock) {
                        const stock = user.stock; // Assuming primary stock
                        const newPrice = Number(stock.currentPrice) * 0.5;

                        await prisma.stock.update({
                            where: { id: stock.id },
                            data: { currentPrice: newPrice }
                        });
                    }
                } catch (e) {
                    console.error("Failed to slash stock price:", e);
                }

                // 3. Public Shame Message
                await message.reply(`🚨 **SEC RAID!** 🚨\n${message.author} has been jailed for market manipulation (spamming). Their stock price has been slashed by 50%.`);

                // Clear history so they don't get triggered immediately after jail expires (optional)
                await redis.del(msgHistoryKey);

                return;
            }
        }


        // --- 4. Filter B: Repetition ---
        const contentHash = crypto.createHash('sha256').update(message.content.toLowerCase()).digest('hex');
        const lastMsgHashKey = getRedisKey('user:last_msg');
        const lastHash = await redis.get(lastMsgHashKey);

        if (lastHash === contentHash) {
            return; // Ignore duplicate message
        }
        // Update last message hash
        await redis.set(lastMsgHashKey, contentHash, 'EX', 60); // Keep for a minute


        // --- 5. Filter C: 30-Second Bucket (Cooldown) ---
        const lastRewardKey = getRedisKey('user:last_reward');
        const lastReward = await redis.get(lastRewardKey);

        if (lastReward) {
            return; // Within 30s window, ignore for points/DB
        }
        // Set new cooldown
        await redis.set(lastRewardKey, String(now), 'EX', 30);


        // --- 6. DB Operations (with Memory Cache) ---
        try {
            // User Cache Check (Already done at top, but if missing we need to fetch/create)

            let internalUserId = cachedUser?.id;

            if (!internalUserId) {
                // Use Upsert to prevent race conditions
                const user = await prisma.user.upsert({
                    where: {
                        discordId_guildId: {
                            discordId: discordId,
                            guildId: guildId
                        }
                    },
                    update: {}, // No updates needed if found
                    create: {
                        discordId: discordId,
                        guildId: guildId,
                        username: message.author.username,
                        stock: {
                            create: {
                                symbol: message.author.username.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X') || 'USR',
                                currentPrice: 10.00
                            }
                        }
                    },
                    include: { stock: true }
                });

                internalUserId = user.id;

                // Cache the user existence AND Jail Status
                // Check if user was actually jailed (if we found existing user via upsert)
                const jailedUntil = user.jailedUntil ? user.jailedUntil.getTime() : null;

                const cacheObj = {
                    id: internalUserId,
                    jailedUntil: jailedUntil
                };

                await redis.set(userCacheKey, JSON.stringify(cacheObj), 'EX', 60 * 60 * 24);

                // Re-check jail matching logic (edge case: user was jailed in DB but cache expired)
                if (jailedUntil && jailedUntil > now) {
                    return;
                }
            }

            // Log activity (Only happens every 30s per user now)
            await prisma.activityLog.create({
                data: {
                    userId: internalUserId, // Use internal UUID
                    type: 'MESSAGE',
                    value: message.content.length,
                    metadata: {
                        channelId: message.channel.id,
                        contentHash: contentHash
                    }
                }
            });

        } catch (error) {
            console.error("Error processing message activity:", error);
            // In case of error (e.g. Redis down), we might want to fail gracefully or fallback
        }
    },
};
