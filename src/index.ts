import { ShardingManager } from 'discord.js';
import path from 'path';
import dotenv from 'dotenv';
import { redisCache } from './redis';

dotenv.config();

const TOTAL_SHARDS = parseInt(process.env.TOTAL_SHARDS || '1');
const CLUSTERS = parseInt(process.env.CLUSTERS || '1');
const LOCK_TTL_SECONDS = 30;

async function acquireClusterId(): Promise<number | null> {
    const containerId = process.env.HOSTNAME || Math.random().toString(36);

    for (let id = 0; id < CLUSTERS; id++) {
        const key = `shard_cluster_lock:${id}`;

        const result = await redisCache.set(key, containerId, 'EX', LOCK_TTL_SECONDS, 'NX');

        if (result === 'OK') {
            console.log(`[Manager] Successfully claimed Cluster ID ${id}`);
            startHeartbeat(id, containerId);
            return id;
        }
    }
    return null;
}

function startHeartbeat(id: number, containerId: string) {
    setInterval(async () => {
        const key = `shard_cluster_lock:${id}`;
        const currentOwner = await redisCache.get(key);
        if (currentOwner === containerId) {
            await redisCache.expire(key, LOCK_TTL_SECONDS);
        } else {
            console.error(`[Manager] FATAL: Lost lock for Cluster ${id}. Exiting to restart...`);
            process.exit(1);
        }
    }, 10000);
}

async function bootstrap() {
    console.log(`[Manager] Booting up... Waiting for a free cluster slot (Total: ${CLUSTERS})...`);

    let myClusterId: number | null = null;

    while (myClusterId === null) {
        myClusterId = await acquireClusterId();
        if (myClusterId === null) {
            console.log('[Manager] All slots taken. Retrying in 5s...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

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
        totalShards: TOTAL_SHARDS,
        shardList: myShardList,
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