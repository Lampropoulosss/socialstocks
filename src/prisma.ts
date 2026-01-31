import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// 1. Create a connection pool using your DATABASE_URL
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE) : 10
});

// 2. Create the Prisma Adapter
const adapter = new PrismaPg(pool);

// 3. Instantiate PrismaClient with the adapter
const prisma = new PrismaClient({
    adapter
});

export default prisma;