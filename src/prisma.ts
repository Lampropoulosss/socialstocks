import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE) : 10
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter
});

export default prisma;