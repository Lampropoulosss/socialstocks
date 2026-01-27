import { Events, Message } from 'discord.js';
import redis, { checkMessageFlow } from '../redis';
import { ActivityData, ActivityService } from '../services/activityService';
import { ActivityType } from '@prisma/client';

module.exports = {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot || !message.guild) return;

        const discordId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        // 1. Single Atomic Lua Call (Jail check, Spam check, Cooldown check)
        // We hash content here to save bandwidth sending massive strings to Redis
        const contentHash = require('crypto').createHash('md5').update(message.content).digest('hex');

        // Pass a "1" as the last arg to say "This is a message event"
        const [status, reason] = (await checkMessageFlow(guildId, discordId, contentHash, now)) as [string, string?];

        if (status === 'JAILED' || status === 'TRIGGER_JAIL') {
            // Optional: DM user or generic Jail logic
            return;
        }
        if (status === 'DUPLICATE') return; // Silent ignore

        // 2. Buffer Activity using DISCORD ID (Not Internal ID)
        // We do not await this. Fire and forget.
        ActivityService.bufferActivity({
            discordId: discordId,
            guildId: guildId,
            username: message.author.username,
            type: ActivityType.MESSAGE,
            value: message.content.length,
            metadata: { channelId: message.channel.id }
        });
    },
};
