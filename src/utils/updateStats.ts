import { Client, ActivityType } from 'discord.js';

let updateTimeout: NodeJS.Timeout | null = null;

// How long to wait after the last event before updating (in ms)
const DEBOUNCE_WAIT = 60 * 1000;

export async function updateBotStats(client: Client) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(async () => {
        try {
            console.log('Debounce finished. Calculating and posting stats...');

            const serverCount = client.guilds.cache.size;

            let totalServerCount = serverCount;
            if (client.shard) {
                const results = await client.shard.fetchClientValues('guilds.cache.size') as number[];
                totalServerCount = results.reduce((acc, guildCount) => acc + guildCount, 0);
            }

            client.user?.setActivity(`${totalServerCount} servers! | /help`, { type: ActivityType.Watching });

            const clientId = process.env.CLIENT_ID;
            const topggToken = process.env.TOP_GG_TOKEN;

            if (!clientId || !topggToken) return;

            const body = {
                server_count: totalServerCount
            };

            const response = await fetch(`https://top.gg/api/bots/${clientId}/stats`, {
                method: 'POST',
                headers: {
                    'Authorization': topggToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                console.log(`[Top.gg] Global stats updated: ${totalServerCount} servers`);
            } else {
                console.error(`[Top.gg] Failed to update: ${response.statusText}`);
            }
            updateTimeout = null;

        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }, DEBOUNCE_WAIT);
}