# SocialStock

**SocialStock** is a unique Discord economy bot that turns server activity into a stock market.

Every user becomes a tradable stock, and their stock price fluctuates based on their participation in the server (messages, voice chat, reactions).

Invest in your friends, manage your portfolio, and compete for the highest net worth!

> [!IMPORTANT]
> **Source Available**: This repository is public for **transparency and security auditing purposes only**.
> This is **not** open-source software. You are **not** permitted to host, deploy, or distribute a public instance of this bot.
> Please refer to [Terms of Service](TERMS.md) for full usage details.

## Features

- **Activity-Based Stocks**: User stock prices rise dynamically based on message count, voice duration, and engagement.
- **Real-time Economy**: Prices update instantly based on user interactions.
- **Portfolio Management**: Buy and sell shares of other users to grow your wealth.
- **Items & Power-ups**: Use items like *Liquid Luck* and *Bullhorn* to boost your stats or influence the market.
- **Leaderboards**: Track the "Richest Users" and "Most Valuable Stocks" across the server.
- **Jail System**: Anti-spam measures that "jail" users for unnatural activity patterns, freezing their stock.

## Tech Stack

- **Language**: TypeScript (Node.js)
- **Framework**: Discord.js
- **Database**: PostgreSQL (via Prisma ORM)
- **Caching/Queues**: Redis
- **Infrastructure**: Docker & Docker Compose

## Commands

| Command | Description |
| :--- | :--- |
| `/profile [user?]` | Check your or another user's balance and portfolio. |
| `/market` | See the top stocks available to buy. |
| `/leaderboard` | View the richest users on the platform. |
| `/buy [user] [amount] [max_price?]` | Buy shares of a friend. |
| `/sell [user] [amount]` | Sell shares for profit. |
| `/shop` | View items available for purchase. |
| `/buy_item [item_name] [target]` | Buy an item from the shop. |
| `/rename_ticker [user] [new_ticker]` | Rename a stock ticker (Majority Shareholder). |
| `/help` | Show this message. |

## Legal & Privacy

- **[Privacy Policy](PRIVACY.md)**: How we handle your data.
- **[Terms of Service](TERMS.md)**: Rules for using the bot.

## Security & Transparency

The code is made public so users can verify how the economy works and ensure fair play.
If you discover a security vulnerability or critical bug, please report it to us immediately.

### Contributing
While we appreciate community interest, this is a distinct product.
- **Bug Reports**: Welcome! Please open an issue.
- **Pull Requests**: We accept PRs that fix bugs or improve security. Feature additions should be discussed first.
- **Forks**: You may fork this repository for **private analysis only**. Publicly hosted forks are a violation of our Terms of Service.
