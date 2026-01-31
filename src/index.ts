import { ShardingManager } from 'discord.js';
import path from 'path';
import dotenv from 'dotenv';
import { redisCache } from './redis';

dotenv.config();

// Configuration
const TOTAL_SHARDS = parseInt(process.env.TOTAL_SHARDS || '1');
const CLUSTERS = parseInt(process.env.CLUSTERS || '1');
const LOCK_TTL_SECONDS = 30;

/**
 * Attempts to claim a Cluster ID (0 to CLUSTERS-1) using Redis.
 * Returns the ID if successful, or null if all slots are taken.
 */
async function acquireClusterId(): Promise<number | null> {
    const containerId = process.env.HOSTNAME || Math.random().toString(36);

    for (let id = 0; id < CLUSTERS; id++) {
        const key = `shard_cluster_lock:${id}`;

        // Try to set the lock ONLY if it doesn't exist (NX) with an expiration (EX)
        const result = await redisCache.set(key, containerId, 'EX', LOCK_TTL_SECONDS, 'NX');

        if (result === 'OK') {
            console.log(`[Manager] Successfully claimed Cluster ID ${id}`);
            startHeartbeat(id, containerId);
            return id;
        }
    }
    return null;
}

/**
 * Refreshes the Redis lock every 10 seconds so the cluster stays claimed.
 */
function startHeartbeat(id: number, containerId: string) {
    setInterval(async () => {
        const key = `shard_cluster_lock:${id}`;
        // Extend the lock only if WE still own it
        // (Lua script ensures atomicity, but simple set is usually fine for this scale)
        const currentOwner = await redisCache.get(key);
        if (currentOwner === containerId) {
            await redisCache.expire(key, LOCK_TTL_SECONDS);
        } else {
            console.error(`[Manager] FATAL: Lost lock for Cluster ${id}. Exiting to restart...`);
            process.exit(1); // Docker will restart us, and we'll try to find a free slot again
        }
    }, 10000);
}

async function bootstrap() {
    console.log(`[Manager] Booting up... Waiting for a free cluster slot (Total: ${CLUSTERS})...`);

    let myClusterId: number | null = null;

    // Retry loop until we find a slot
    while (myClusterId === null) {
        myClusterId = await acquireClusterId();
        if (myClusterId === null) {
            console.log('[Manager] All slots taken. Retrying in 5s...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Calculate which shards this container is responsible for
    // Example: Total 4 shards, 2 Clusters.
    // Cluster 0 gets [0, 1]. Cluster 1 gets [2, 3].
    const shardsPerCluster = Math.ceil(TOTAL_SHARDS / CLUSTERS);
    const myShardList: number[] = [];

    for (let i = 0; i < shardsPerCluster; i++) {
        const shardId = (myClusterId * shardsPerCluster) + i;
        if (shardId < TOTAL_SHARDS) {
            myShardList.push(shardId);
        }
    }

    console.log(`[Manager] Cluster ${myClusterId} initialized. Managing Shards: [${myShardList.join(', ')}]`);

    const manager = new ShardingManager(path.join(__dirname, 'bot.js'), {
        token: process.env.DISCORD_TOKEN,
        totalShards: TOTAL_SHARDS, // Important: Tells discord the GLOBAL total
        shardList: myShardList,    // Important: Tells this manager ONLY to run these
        respawn: true
    });

    manager.on('shardCreate', shard => console.log(`[Manager] Launched shard ${shard.id}`));

    try {
        await manager.spawn();
    } catch (error) {
        console.error('[Manager] Error spawning shards:', error);
    }
}

bootstrap().catch(console.error);