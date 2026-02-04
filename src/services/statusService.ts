import { Client, ActivityType } from 'discord.js';
import { redisCache } from '../redis';

const UPDATE_INTERVAL_MINUTES = 15;
const REDIS_KEY_GUILD_COUNTS = 'bot:guild_counts';

export const startStatusUpdater = (client: Client) => {
    const reportData = async () => {
        const shardId = client.shard?.ids[0] ?? 0;
        const guildCount = client.guilds.cache.size;
        await redisCache.hset(REDIS_KEY_GUILD_COUNTS, `shard:${shardId}`, guildCount);
        // Refresh expiration
        await redisCache.expire(REDIS_KEY_GUILD_COUNTS, UPDATE_INTERVAL_MINUTES * 60 * 2);
    };

    // ONLY calculate total and update status if this is Shard 0 
    // (Or the lowest ID shard in this specific process if using grouped shards)
    const updatePresence = async () => {
        try {
            const allCounts = await redisCache.hgetall(REDIS_KEY_GUILD_COUNTS);
            let totalGuilds = 0;
            for (const count of Object.values(allCounts)) {
                totalGuilds += parseInt(count, 10) || 0;
            }

            client.user?.setActivity({
                name: `${totalGuilds} servers!`,
                type: ActivityType.Watching,
            });

            console.log(`[Status] Updated for Shard 0: Watching ${totalGuilds} servers!`);
        } catch (error) {
            console.error('[Status] Failed to update presence:', error);
        }
    };

    reportData().then(() => {
        if (client.shard?.ids[0] === 0) {
            updatePresence();
        }
    });

    setInterval(async () => {
        await reportData();
        if (client.shard?.ids[0] === 0) {
            await updatePresence();
        }
    }, UPDATE_INTERVAL_MINUTES * 60 * 1000);

    const cleanUp = async () => {
        const shardId = client.shard?.ids[0] ?? 0;
        console.log(`[Status] Cleaning up Redis count for shard ${shardId}...`);
        await redisCache.hdel(REDIS_KEY_GUILD_COUNTS, `shard:${shardId}`);
    };

    process.on('SIGTERM', cleanUp);
    process.on('SIGINT', cleanUp);
};