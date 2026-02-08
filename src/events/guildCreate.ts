import { Events, Guild } from 'discord.js';
import { updateBotStats } from '../utils/updateStats';

module.exports = {
    name: Events.GuildCreate,
    async execute(guild: Guild) {
        console.log(`Joined guild: ${guild.name} (${guild.id})`);

        await updateBotStats(guild.client);
    },
};
