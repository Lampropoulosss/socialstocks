import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

export class HelpService {
    static getHelpResponse() {
        const embed = new EmbedBuilder()
            .setTitle('SocialStocks Commands')
            .setColor(Colors.Info)
            .addFields(
                { name: '/profile [user?]', value: 'Check your or another user\'s balance and portfolio.' },
                { name: '/market', value: 'See the top stocks available to buy.' },
                { name: '/leaderboard', value: 'View the richest users on the platform.' },
                { name: '/buy [user] [amount] [max_price?]', value: 'Buy shares of a friend.' },
                { name: '/sell [user] [amount]', value: 'Sell shares for profit.' },
                { name: '/shop', value: 'View items available for purchase.' },
                { name: '/buy_item [item_name] [target]', value: 'Buy an item from the shop.' },
                { name: '/rename_ticker [user] [new_ticker]', value: 'Rename a stock ticker (Majority Shareholder).' },
                { name: '/help', value: 'Show this message.' }
            )
            .setFooter({ text: 'Market based on message and voice activity!' });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_profile')
                    .setLabel(ButtonLabels.Profile)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(Emojis.Profile),
                new ButtonBuilder()
                    .setCustomId('refresh_market')
                    .setLabel(ButtonLabels.Market)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(Emojis.Market),
                new ButtonBuilder()
                    .setCustomId('refresh_leaderboard')
                    .setLabel(ButtonLabels.Leaderboard)
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(Emojis.Leaderboard),
                new ButtonBuilder()
                    .setLabel(ButtonLabels.Support)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji(Emojis.Support)
                    .setURL('https://discord.gg/Sy2mqyNvBT')
            );

        return { embeds: [embed], components: [row] };
    }
}
