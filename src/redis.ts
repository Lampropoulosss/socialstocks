import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

export const redisCache = new Redis(process.env.REDIS_CACHE_URL!);

export const redisQueue = new Redis(process.env.REDIS_QUEUE_URL!);

redisCache.on('error', (err) => console.error('Redis Cache Error:', err));
redisQueue.on('error', (err) => console.error('Redis Queue Error:', err));

const messageCheckScript = `
    local guildId = KEYS[1]
    local discordId = KEYS[2]
    local now = tonumber(ARGV[1])

    local jailKey = "u:j:" .. guildId .. ":" .. discordId
    local spamKey = "s:t:" .. guildId .. ":" .. discordId
    local cooldownKey = "u:cd:" .. guildId .. ":" .. discordId

    if redis.call('EXISTS', jailKey) == 1 then
        return { 'JAILED' }
    end
    redis.call('RPUSH', spamKey, now)
    redis.call('LTRIM', spamKey, -6, -1) 
    redis.call('EXPIRE', spamKey, 60)
    
    local history = redis.call('LRANGE', spamKey, 0, -1)
    if #history >= 6 then
        local first = tonumber(history[1])
        local last = tonumber(history[#history])
        if (last - first) < 4000 then 
            redis.call('SET', jailKey, 1, 'EX', 300) 
            return { 'TRIGGER_JAIL' }
        end
    end

    if redis.call('EXISTS', cooldownKey) == 1 then
        return { 'COOLDOWN' }
    end
    redis.call('SET', cooldownKey, 1, 'EX', 30)

    return { 'OK' }
`;

export const checkMessageFlow = async (
    guildId: string,
    discordId: string,
    now: number
) => {
    // @ts-ignore
    return redisCache.eval(
        messageCheckScript,
        2,
        guildId,
        discordId,
        String(now)
    );
};