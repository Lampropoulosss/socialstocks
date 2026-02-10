import { Events, Message } from 'discord.js';
import { checkMessageFlow } from '../redis';
import { ActivityService, ActivityType } from '../services/activityService';
import { ProfileService } from '../services/profileService'; // Import this

module.exports = {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot || !message.guild) return;

        const discordId = message.author.id;
        const guildId = message.guild.id;

        // --- ADDED: Opt-out check ---
        // We check Redis first to ensure high performance
        const isOptedOut = await ProfileService.isUserOptedOut(discordId, guildId);
        if (isOptedOut) return; // Completely ignore

        const now = Date.now();

        const [status] = (await checkMessageFlow(guildId, discordId, now)) as [string, string?];

        if (status === 'JAILED' || status === 'TRIGGER_JAIL' || status === 'COOLDOWN') {
            return;
        }

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