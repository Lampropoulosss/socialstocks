import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List all available commands'),
    async execute(interaction: ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle('SocialStock Commands')
            .setColor(0xFFFF00)
            .addFields(
                { name: '/profile', value: 'Check your balance and portfolio.' },
                { name: '/market', value: 'See the top stocks available to buy.' },
                { name: '/buy [user] [amount]', value: 'Buy shares of a friend.' },
                { name: '/sell [user] [amount]', value: 'Sell shares for profit.' },
                { name: '/help', value: 'Show this message.' }
            )
            .setFooter({ text: 'Market based on message and voice activity!' });

        await interaction.reply({ embeds: [embed] });
    },
};
