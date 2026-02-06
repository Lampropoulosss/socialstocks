import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { rest } from '../discord';
import { Routes } from 'discord-api-types/v10';

export default async function guildRoutes(fastify: FastifyInstance) {
    fastify.get('/api/guilds', async (_request, reply) => {
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
            fastify.log.error(err);
            reply.status(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.get('/api/guilds/:id/details', async (request, _reply) => {
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

    fastify.get('/api/guilds/:id/users', async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
            const users = await prisma.user.findMany({
                where: { guildId: id },
                orderBy: { netWorth: 'desc' },
            });

            return users;
        } catch (err) {
            fastify.log.error(err);
            reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
}
