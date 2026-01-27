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
    local userKey = KEYS[1]
    local historyKey = KEYS[2]
    local hashKey = KEYS[3]
    local rewardKey = KEYS[4]
    
    local now = tonumber(ARGV[1])
    local contentHash = ARGV[2]
    local cooldownSeconds = tonumber(ARGV[3])
    
    -- 1. Check Jail (User cache stored as JSON string)
    local userData = redis.call('GET', userKey)
    if userData then
        local decoded = cjson.decode(userData)
        if decoded.jailedUntil and decoded.jailedUntil > now then
            return { 'JAILED', decoded.jailedUntil }
        end
    end

    -- 2. Check Repetition (Hash)
    local lastHash = redis.call('GET', hashKey)
    if lastHash == contentHash then
        return { 'DUPLICATE' }
    end

    -- 3. Burst Detection
    redis.call('RPUSH', historyKey, now)
    redis.call('LTRIM', historyKey, -10, -1) -- Keep last 10
    redis.call('EXPIRE', historyKey, 3600)
    
    local history = redis.call('LRANGE', historyKey, 0, -1)
    if #history >= 10 then
        local first = tonumber(history[1])
        local last = tonumber(history[#history])
        if (last - first) < 3000 then -- 3 seconds for 10 messages
            -- TRIGGER JAIL
            redis.call('DEL', historyKey)
            return { 'TRIGGER_JAIL' }
        end
    end

    -- 4. Update Hash
    redis.call('SET', hashKey, contentHash, 'EX', 60)

    -- 5. Check Reward Cooldown
    local ttl = redis.call('TTL', rewardKey)
    if ttl > 0 then
        return { 'OK', 'COOLDOWN' }
    else
        redis.call('SET', rewardKey, now, 'EX', cooldownSeconds)
        return { 'OK', 'REWARD' }
    end
`;

/**
 * Atomic check for message flow (Jail, Spam, Cooldown)
 */
export const checkMessageFlow = async (
    guildId: string,
    discordId: string,
    contentHash: string,
    now: number
) => {
    const keys = [
        `user:registered:${guildId}:${discordId}`,
        `user:msgs:${guildId}:${discordId}`,
        `user:last_msg:${guildId}:${discordId}`,
        `user:last_reward:${guildId}:${discordId}`
    ];

    // execute script
    // @ts-ignore: ioredis eval definitions can be tricky
    return redis.eval(messageCheckScript, 4, ...keys, String(now), contentHash, '30');
};
