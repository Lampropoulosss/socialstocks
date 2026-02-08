import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from '@fastify/cors';
import guildRoutes from './routes/guilds';
import userRoutes from './routes/users';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: FastifyInstance = Fastify({
    disableRequestLogging: true,
    logger: {
        level: process.env.LOG_LEVEL || 'warn',
    },
});

app.register(cors, {
    origin: '*',
});

app.register(guildRoutes);
app.register(userRoutes);

if (process.env.NODE_ENV === 'production') {
    app.register(fastifyStatic, {
        root: path.join(process.cwd(), 'dist/client'),
        prefix: '/',
    });
}

if (process.env.NODE_ENV === 'production') {
    app.setNotFoundHandler((_req, res) => {
        res.sendFile('index.html');
    });
}

const start = async () => {
    try {
        const host = '0.0.0.0';
        const port = 3040;
        await app.listen({ host, port });
        console.log(`Server running at http://${host}:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
