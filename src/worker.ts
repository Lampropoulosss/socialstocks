import { StockService } from './services/stockService';
import { ActivityService } from './services/activityService';
import { LeaderboardService } from './services/leaderboardService';
import { redisQueue } from './redis';

console.log("Worker Process Started");

const ONE_MINUTE = 60 * 1000;

// 1. Activity Flusher (High frequency)
// Runs every 5 seconds to process buffered messages/voice
setInterval(() => {
    ActivityService.flushActivities().catch(err => console.error("Flush Error:", err));
}, 5000);

// 2. Leaderboard Sync (Medium frequency)
// Runs every hour
setInterval(() => {
    runJobWithLock('job:leaderboard', 55 * ONE_MINUTE, async () => {
        console.log("Running Leaderboard Sync...");
        await LeaderboardService.syncLeaderboard();
    });
}, 60 * ONE_MINUTE);

// 3. Market Decay (Low frequency)
// Runs every 10 minutes
setInterval(() => {
    runJobWithLock('job:decay', 9 * ONE_MINUTE, async () => {
        console.log("Running Market Decay...");
        await StockService.updateAllStocks();
    });
}, 10 * ONE_MINUTE);


/**
 * Simple Redis-based Locking to ensure only ONE worker runs the job
 * even if you deploy multiple worker containers.
 */
async function runJobWithLock(key: string, ttlMs: number, callback: () => Promise<void>) {
    // SETNX (Set if Not Exists)
    const acquired = await redisQueue.set(key, 'locked', 'PX', ttlMs, 'NX');
    if (acquired === 'OK') {
        try {
            await callback();
        } catch (e) {
            console.error(`Job ${key} failed:`, e);
            // Optional: Release lock early on failure, or let it expire
        }
    }
}