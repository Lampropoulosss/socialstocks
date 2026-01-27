import redis from '../redis';
import prisma from '../prisma';
import { ActivityType } from '@prisma/client';

export interface ActivityData {
    userId: string;
    type: ActivityType;
    value: number;
    metadata?: Record<string, any>;
    createdAt?: number; // timestamp
}

export class ActivityService {
    private static BUFFER_KEY = 'activity_buffer';

    /**
     * Buffers an activity to Redis to be processed later in batches.
     * This avoids direct DB writes on high-frequency events like messages.
     */
    static async bufferActivity(data: ActivityData) {
        // Add timestamp if not present
        if (!data.createdAt) {
            data.createdAt = Date.now();
        }
        await redis.rpush(this.BUFFER_KEY, JSON.stringify(data));
    }

    /**
     * Flushes buffered activities from Redis to the Database in a single transaction.
     * Should be called periodically (e.g., every 30s).
     */
    static async flushActivities() {
        const BATCH_SIZE = 500; // Process 500 at a time

        // 1. Pop items atomically
        // "count" is supported in Redis 6.2+. 
        // @ts-ignore: ioredis types might not mention count arg yet depending on version
        const items = await redis.lpop(this.BUFFER_KEY, BATCH_SIZE);

        if (!items || (Array.isArray(items) && items.length === 0)) return;

        // Ensure we handle single item return if older redis/ioredis behavior (unlikely with count arg, but good for safety)
        const itemList = Array.isArray(items) ? items : [items];

        // 2. Parse
        const logs = itemList.map(item => {
            try {
                return JSON.parse(item);
            } catch (e) {
                return null;
            }
        }).filter(l => l !== null);

        // 3. Insert
        if (logs.length > 0) {
            try {
                await prisma.activityLog.createMany({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: logs.map((log: any) => ({
                        userId: log.userId,
                        type: log.type,
                        value: log.value,
                        metadata: log.metadata || {},
                        processed: false,
                        createdAt: new Date(log.createdAt || Date.now())
                    }))
                });
                console.log(`Flushed ${logs.length} activities.`);
            } catch (e) {
                console.error("DB Error, pushing back to buffer", e);
                // Rescue strategy: Push back to head of list
                // Store strings back
                await redis.lpush(this.BUFFER_KEY, ...itemList);
            }
        }

        // 4. Recursive check? 
        // If we pulled a full batch, there might be more. 
        if (itemList.length === BATCH_SIZE) {
            setImmediate(() => this.flushActivities());
        }
    }
}
