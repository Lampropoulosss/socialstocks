import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { z } from 'zod';

const UpdateUserSchema = z.object({
    balance: z.number().optional(),
    netWorth: z.number().optional(),
});

export default async function userRoutes(fastify: FastifyInstance) {
    fastify.patch('/api/users/:id', async (request, reply) => {
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
            fastify.log.error(err);
            reply.status(400).send({ error: 'Invalid Request' });
        }
    });
}
