# Privacy Policy

**Last Updated:** February 8, 2026

**SocialStocks** ("we", "our", or "the Bot") is committed to protecting your privacy. This Privacy Policy explains what data we collect, how we use it, and your rights regarding your information.

## 1. Data We Collect

To function as an activity-based stock market simulation, the Bot collects specific information about your interactions within Discord servers where the Bot is present.

### A. User Identification
* **Discord User ID:** Stored to identify your unique stock profile and portfolio.
* **Username:** Stored to display your stock symbol (e.g., "USR") and leaderboard entry.
* **Guild (Server) ID:** Stored to maintain separate economies and leaderboards for each server.

### B. Activity Metrics (The "Stock" Mechanism)
The Bot processes the following data to calculate your "Stock Price." **We do not store the content of your messages.**
* **Message Volume:** We log the character count of messages sent to calculate activity scores.
* **Voice Activity:** We track the duration of time (in minutes) spent in voice channels. We **do not** record or listen to audio.
* **Reactions:** We count reactions received on your messages to calculate engagement.

### C. Financial Data
* **Virtual Balance:** Your current holding of the in-game currency.
* **Portfolio Holdings:** Records of virtual stocks you have bought or sold.
* **Transaction History:** Logs of buy/sell orders for audit and ledger purposes.
* **Inventory Items:** Records of consumable items (e.g., "Liquid Luck", "Bullhorn") you own or have active.

## 2. How We Use Data

We use the collected data for the following purposes:
1.  **Gameplay Mechanics:** To dynamically adjust your "Stock Price" based on your activity (e.g., high activity increases stock value).
2.  **Leaderboards:** To display top investors and highest-valued users in the server.
3.  **Security:** To detect automated spamming or abuse (e.g., applying "Jail" status to prevent economy inflation).

## 3. Data Storage & Retention

* **Storage:** Data is stored securely in our database (PostgreSQL/Redis).
* **Retention:** Data is retained for as long as you or the server uses the Bot.
* **Automatic Deletion:** If the Bot is removed/kicked from a server, we automatically delete all user data, stocks, and portfolios associated with that specific Guild ID to ensure your privacy.

## 4. Data Sharing

We do not sell, trade, or transfer your data to outside parties. Data is only accessible to the core development team for maintenance and debugging purposes.

## 5. Your Rights

* **Access:** You can view your stored profile data at any time using the `/profile` command in Discord.
* **Deletion:** You may request the deletion of your data by:
    1. Removing the Bot from your server (triggers automatic wipe).
    2. Contacting us in our Support Server to request a manual deletion of your specific User ID.

## 6. Contact

If you have questions about this Privacy Policy, please contact us at contact@ioannislampropoulos.com or join our https://discord.gg/Sy2mqyNvBT.