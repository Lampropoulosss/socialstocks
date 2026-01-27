import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl);

redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

export default redis;

// Define the Lua script for atomic checks
const messageCheckScript = `
    local guildId = KEYS[1]
    local discordId = KEYS[2]
    local now = tonumber(ARGV[1])
    local contentHash = ARGV[2]

    -- Keys
    local jailKey = "user:jail:" .. guildId .. ":" .. discordId
    local hashKey = "spam:hash:" .. guildId .. ":" .. discordId
    local spamKey = "spam:times:" .. guildId .. ":" .. discordId

    -- 1. Check Jail (Fail fast)
    if redis.call('EXISTS', jailKey) == 1 then
        return { 'JAILED' }
    end

    -- 2. Duplicate Check
    local lastHash = redis.call('GET', hashKey)
    if lastHash == contentHash then
        return { 'DUPLICATE' }
    end
    redis.call('SET', hashKey, contentHash, 'EX', 60)

    -- 3. Rate Limit / Burst (Sliding Window)
    redis.call('RPUSH', spamKey, now)
    -- Keep last 6 timestamps
    redis.call('LTRIM', spamKey, -6, -1) 
    redis.call('EXPIRE', spamKey, 60)
    
    local history = redis.call('LRANGE', spamKey, 0, -1)
    if #history >= 6 then
        local first = tonumber(history[1])
        local last = tonumber(history[#history])
        
        -- If 6 messages in less than 4 seconds (Burst)
        if (last - first) < 4000 then 
            -- JAIL THEM in Redis for 5 mins
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
    // @ts-ignore
    return redis.eval(
        messageCheckScript,
        2, // Number of KEYS
        guildId,
        discordId,
        // ARGS
        String(now),
        contentHash
    );
};
