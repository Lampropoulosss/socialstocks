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
                { name: '/buy [user] [amount] [max_price?]', value: 'Buy shares of a friend.' },
                { name: '/sell [user] [amount]', value: 'Sell shares for profit.' },
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
                    .setEmoji(Emojis.Leaderboard)
            );

        return { embeds: [embed], components: [row] };
    }
}
