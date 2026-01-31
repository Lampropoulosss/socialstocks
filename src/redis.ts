import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

// 1. Cache Client: Used for Spam checks, Leaderboards, Usernames
// It is allowed to drop keys if memory is full.
export const redisCache = new Redis(process.env.REDIS_CACHE_URL!);

// 2. Queue Client: Used for Activity Buffers, Voice Tracking
// This holds money-related logic steps, so it must not lose data.
export const redisQueue = new Redis(process.env.REDIS_QUEUE_URL!);

redisCache.on('error', (err) => console.error('Redis Cache Error:', err));
redisQueue.on('error', (err) => console.error('Redis Queue Error:', err));

// Default export for backward compatibility (points to cache)
export default redisCache;

// --- OPTIMIZED LUA SCRIPT (Strategy B) ---
// We shortened keys: "user:jail" -> "u:j", "spam:hash" -> "s:h", etc.
const messageCheckScript = `
    local guildId = KEYS[1]
    local discordId = KEYS[2]
    local now = tonumber(ARGV[1])
    local contentHash = ARGV[2]

    -- Shortened Keys to save RAM
    local jailKey = "u:j:" .. guildId .. ":" .. discordId
    local hashKey = "s:h:" .. guildId .. ":" .. discordId
    local spamKey = "s:t:" .. guildId .. ":" .. discordId

    -- 1. Check Jail
    if redis.call('EXISTS', jailKey) == 1 then
        return { 'JAILED' }
    end

    -- 2. Duplicate Check
    local lastHash = redis.call('GET', hashKey)
    if lastHash == contentHash then
        return { 'DUPLICATE' }
    end
    redis.call('SET', hashKey, contentHash, 'EX', 60)

    -- 3. Rate Limit / Burst
    redis.call('RPUSH', spamKey, now)
    redis.call('LTRIM', spamKey, -6, -1) 
    redis.call('EXPIRE', spamKey, 60)
    
    local history = redis.call('LRANGE', spamKey, 0, -1)
    if #history >= 6 then
        local first = tonumber(history[1])
        local last = tonumber(history[#history])
        
        if (last - first) < 4000 then 
            -- JAIL: 5 mins
            redis.call('SET', jailKey, 1, 'EX', 300) 
            return { 'TRIGGER_JAIL' }
        end
    end

    return { 'OK' }
`;

export const checkMessageFlow = async (
    guildId: string,
    discordId: string,
    contentHash: string,
    now: number
) => {
    // Spam protection is transient, so we use redisCache
    // @ts-ignore
    return redisCache.eval(
        messageCheckScript,
        2,
        guildId,
        discordId,
        String(now),
        contentHash
    );
};