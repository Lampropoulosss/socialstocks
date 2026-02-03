import { StockService } from './services/stockService';
import { ActivityService } from './services/activityService';
import { LeaderboardService } from './services/leaderboardService';
import { redisQueue } from './redis';

console.log("Worker Process Started");

const ONE_MINUTE = 60 * 1000;

setInterval(() => {
    ActivityService.flushActivities().catch(err => console.error("Flush Error:", err));
}, 5000);

setInterval(() => {
    runJobWithLock('job:leaderboard', 55 * ONE_MINUTE, async () => {
        console.log("Running Leaderboard Sync...");
        await LeaderboardService.syncLeaderboard();
    });
}, 60 * ONE_MINUTE);

setInterval(() => {
    runJobWithLock('job:decay', 9 * ONE_MINUTE, async () => {
        console.log("Running Market Decay...");
        await StockService.updateAllStocks();
    });
}, 10 * ONE_MINUTE);

setInterval(() => {
    runJobWithLock('job:networth_recalc', 55 * ONE_MINUTE, async () => {
        await LeaderboardService.recalculateAllNetWorths();
    });
}, 60 * ONE_MINUTE);


async function runJobWithLock(key: string, ttlMs: number, callback: () => Promise<void>) {
    const acquired = await redisQueue.set(key, 'locked', 'PX', ttlMs, 'NX');
    if (acquired === 'OK') {
        try {
            await callback();
        } catch (e) {
            console.error(`Job ${key} failed:`, e);
        }
    }
}