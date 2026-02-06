import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { REST } from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';


dotenv.config({ path: path.join(process.cwd(), '../.env') });

if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
}

const connectionString = process.env.DATABASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
    connectionString,
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE) : 10
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter
});

const app: FastifyInstance = Fastify({ logger: true });

// Discord API setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN");
    process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

app.register(cors, {
    origin: '*',
});

if (process.env.NODE_ENV === 'production') {
    app.register(fastifyStatic, {
        root: path.join(__dirname, '../../dist/client'),
        prefix: '/',
    });
}

app.get('/api/guilds', async (_request, reply) => {
    try {
        const guildCounts = await prisma.user.groupBy({
            by: ['guildId'],
            _count: {
                _all: true,
            },
        });

        const guilds = guildCounts.map(g => ({
            id: g.guildId,
            userCount: g._count._all,
            name: null,
            icon: null,
        }));

        return guilds;
    } catch (err) {
        app.log.error(err);
        reply.status(500).send({ error: 'Internal Server Error' });
    }
});

app.get('/api/guilds/:id/details', async (request, _reply) => {
    const { id } = request.params as { id: string };
    try {
        const guild: any = await rest.get(Routes.guild(id));
        return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        };
    } catch (e) {
        console.error(`Failed to fetch details for guild ${id}`, e);
        return {
            id,
            name: 'Unknown Guild',
            icon: null
        };
    }
});

app.get('/api/guilds/:id/users', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
        const users = await prisma.user.findMany({
            where: { guildId: id },
            orderBy: { netWorth: 'desc' },
        });

        return users;
    } catch (err) {
        app.log.error(err);
        reply.status(500).send({ error: 'Internal Server Error' });
    }
});

const UpdateUserSchema = z.object({
    balance: z.number().optional(),
    netWorth: z.number().optional(),
});

app.patch('/api/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
        const body = UpdateUserSchema.parse(request.body);

        const updatedUser = await prisma.user.update({
            where: { id },
            data: {
                ...body,
            },
        });

        return updatedUser;
    } catch (err) {
        app.log.error(err);
        reply.status(400).send({ error: 'Invalid Request' });
    }
});

if (process.env.NODE_ENV === 'production') {
    app.setNotFoundHandler((_req, res) => {
        res.sendFile('index.html');
    });
}

const start = async () => {
    try {
        const host = '0.0.0.0';
        const port = 3000;
        await app.listen({ host, port });
        console.log(`Server running at http://${host}:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
