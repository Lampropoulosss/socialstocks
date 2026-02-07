import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { redisCache, redisQueue } from './redis';

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import prisma from './prisma';

dotenv.config();

const requiredEnv = ['DISCORD_TOKEN', 'DATABASE_URL', 'REDIS_CACHE_URL', 'REDIS_QUEUE_URL'];
for (const env of requiredEnv) {
    if (!process.env[env]) {
        console.error(`FATAL: Missing environment variable ${env}`);
        process.exit(1);
    }
}

declare module 'discord.js' {
    interface Client {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        commands: Collection<string, any>;
        prisma: PrismaClient;
        redisCache: typeof redisCache;
        redisQueue: typeof redisQueue;
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
    ],
});

client.commands = new Collection();
client.prisma = prisma;
client.redisCache = redisCache;
client.redisQueue = redisQueue;

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
    }
}

client.login(process.env.DISCORD_TOKEN);
