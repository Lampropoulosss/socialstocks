import { REST } from 'discord.js';

if (!process.env.DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN");
    process.exit(1);
}

export const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
