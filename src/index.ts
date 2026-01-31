import { ShardingManager } from 'discord.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const manager = new ShardingManager(path.join(__dirname, 'bot.js'), {
    token: process.env.DISCORD_TOKEN,
    totalShards: 'auto', // Automatically calculates needed shards
    respawn: true
});

manager.on('shardCreate', shard => console.log(`Launched shard ${shard.id}`));

manager.spawn();