import { Events, Message } from 'discord.js';
import { checkMessageFlow } from '../redis';
import { ActivityService, ActivityType } from '../services/activityService';

module.exports = {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot || !message.guild) return;

        const discordId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        // 1. Single Atomic Lua Call
        const [status] = (await checkMessageFlow(guildId, discordId, now)) as [string, string?];

        if (status === 'JAILED' || status === 'TRIGGER_JAIL' || status === 'COOLDOWN') {
            return;
        }

        // 2. Buffer Activity
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