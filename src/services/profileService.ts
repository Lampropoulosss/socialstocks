import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Decimal from 'decimal.js';
import prisma from '../prisma';
import { redisCache } from '../redis';
import { Colors, ButtonLabels, Emojis } from '../utils/theme';

const CONSTANTS = {
    DEFAULT_BALANCE: 100.00,
    DEFAULT_NET_WORTH: 0.00,
    DEFAULT_STOCK_PRICE: 10.00,
    DEFAULT_VOLATILITY: 0.05,
    DEFAULT_TOTAL_SHARES: 2000,
    CACHE_TTL_PROFILE: 15,
    CACHE_TTL_OPTOUT: 86400,
    PAGE_SIZE: 10
};

export class ProfileService {

    static async getProfileResponse(userId: string, guildId: string, username: string, viewerId?: string, page: number = 1) {
        const requestingUser = viewerId || userId;
        const cacheKey = `view:profile:${guildId}:${userId}:${requestingUser}:${page}`;

        // 1. Cache Check
        const cachedData = await redisCache.get(cacheKey);
        if (cachedData) return JSON.parse(cachedData);

        // 2. The "Super Query" with Pagination
        const user = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: userId, guildId } },
            include: {
                stock: {
                    include: {
                        portfolios: viewerId && viewerId !== userId ? {
                            where: { owner: { discordId: viewerId, guildId } },
                            select: { shares: true },
                            take: 1
                        } : false,
                    }
                },
                portfolio: {
                    skip: (page - 1) * CONSTANTS.PAGE_SIZE,
                    take: CONSTANTS.PAGE_SIZE,
                    orderBy: { shares: 'desc' },
                    include: {
                        stock: {
                            include: {
                                user: {
                                    select: { username: true }
                                }
                            }
                        }
                    }
                },
                _count: {
                    select: { portfolio: true }
                }
            }
        });

        if (!user) return null;

        // Majority Shareholder Logic
        let majorityShareholderUsername: string | null = null;
        if (user.stock) {
            const topPortfolio = await prisma.portfolio.findFirst({
                where: {
                    stockId: user.stock.id,
                    ownerId: { not: user.id },
                    shares: { gt: 0 }
                },
                orderBy: { shares: 'desc' },
                select: { owner: { select: { username: true } } }
            });
            if (topPortfolio) majorityShareholderUsername = topPortfolio.owner.username;
        }

        const balance = new Decimal(String(user.balance));
        const netWorth = new Decimal(String(user.netWorth));
        const stockPrice = new Decimal(String(user.stock?.currentPrice ?? 0));
        const totalShares = new Decimal(user.stock?.totalShares ?? CONSTANTS.DEFAULT_TOTAL_SHARES);
        const marketCap = stockPrice.times(totalShares);

        const totalPortfolioItems = user._count.portfolio;
        const totalPages = Math.ceil(totalPortfolioItems / CONSTANTS.PAGE_SIZE) || 1;
        const currentPage = Math.max(1, Math.min(page, totalPages));

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Profile`)
            .setColor(Colors.Primary)
            .setFooter({ text: `Page ${currentPage} of ${totalPages} • Total Holdings: ${totalPortfolioItems}` });

        if (user.stock) {
            if (majorityShareholderUsername) {
                embed.setDescription(`🔒 **Property of ${majorityShareholderUsername}**`);
            }
            const outstanding = user.stock.sharesOutstanding;
            const maxShares = user.stock.totalShares;
            const supplyPct = ((outstanding / maxShares) * 100).toFixed(1);

            embed.addFields({ name: 'Supply', value: `${outstanding}/${maxShares} (${supplyPct}%)`, inline: true });

            const viewerHoldingEntry = user.stock.portfolios?.[0];
            if (viewerHoldingEntry) {
                embed.addFields({ name: 'Your Position', value: `${viewerHoldingEntry.shares} shares`, inline: true });
            }
        }

        embed.addFields(
            { name: 'Net Worth', value: `$${netWorth.toFixed(2)}`, inline: true },
            { name: 'Balance', value: `$${balance.toFixed(2)}`, inline: true },
            { name: 'Stock Price', value: `$${stockPrice.toFixed(2)}`, inline: true },
            { name: 'Market Cap', value: `$${marketCap.toFixed(2)}`, inline: true },
        );

        if (user.portfolio.length > 0) {
            const portfolioDesc = user.portfolio.map(p => {
                const currentPrice = new Decimal(String(p.stock.currentPrice));
                const avgBuyPrice = new Decimal(String(p.averageBuyPrice));
                let profitPct = new Decimal(0);

                if (!avgBuyPrice.isZero()) {
                    profitPct = currentPrice.minus(avgBuyPrice).div(avgBuyPrice).times(100);
                }

                const emoji = profitPct.gte(0) ? '🟢' : '🔴';
                return `**${p.stock.symbol}** (${p.stock.user.username}): ${p.shares} shares @ $${avgBuyPrice.toFixed(2)} (Cur: $${currentPrice.toFixed(2)}) ${emoji} ${profitPct.toFixed(1)}%`;
            }).join('\n');

            embed.addFields({ name: 'Your Portfolio', value: portfolioDesc.substring(0, 1024) });
        } else {
            embed.addFields({ name: 'Your Portfolio', value: "No stocks found on this page." });
        }

        const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_page_${userId}_${currentPage - 1}`)
                .setEmoji(Emojis.Previous || '⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId('profile_stats')
                .setLabel(`${currentPage}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`profile_page_${userId}_${currentPage + 1}`)
                .setEmoji(Emojis.Next || '➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );

        const actionRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder().setCustomId('refresh_profile').setLabel(ButtonLabels.Refresh).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Refresh),
                new ButtonBuilder().setCustomId('market_page_1').setLabel(ButtonLabels.Market).setStyle(ButtonStyle.Success).setEmoji(Emojis.Market),
                new ButtonBuilder().setCustomId('refresh_leaderboard').setLabel(ButtonLabels.Leaderboard).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Leaderboard),
                new ButtonBuilder().setCustomId('view_help').setLabel(ButtonLabels.Help).setStyle(ButtonStyle.Secondary).setEmoji(Emojis.Help)
            );

        const responsePayload = { embeds: [embed], components: [navRow, actionRow] };
        await redisCache.set(cacheKey, JSON.stringify(responsePayload), 'EX', CONSTANTS.CACHE_TTL_PROFILE);

        return responsePayload;
    }

    static async isUserOptedOut(userId: string, guildId: string): Promise<boolean> {
        const cacheKey = `optout:${guildId}:${userId}`;
        const cached = await redisCache.get(cacheKey);
        if (cached !== null) return cached === '1';

        const user = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: userId, guildId } },
            select: { isOptedOut: true }
        });

        const status = user?.isOptedOut ?? false;
        await redisCache.set(cacheKey, status ? '1' : '0', 'EX', CONSTANTS.CACHE_TTL_OPTOUT);
        return status;
    }

    static async setOptOutStatus(userId: string, guildId: string, isOptedOut: boolean): Promise<boolean> {
        const cacheKey = `optout:${guildId}:${userId}`;

        try {
            if (isOptedOut) {
                await prisma.$transaction(async (tx) => {
                    // 1. Fetch User & Stock
                    const user = await tx.user.findUnique({
                        where: { discordId_guildId: { discordId: userId, guildId } },
                        include: { stock: true }
                    });

                    if (!user) return;

                    // 2. LIQUIDATE INVESTORS (Bulk Refund)
                    if (user.stock) {
                        await tx.$executeRaw`
                            UPDATE "User" u
                            SET balance = balance + (p.shares * ${user.stock.currentPrice}::numeric), 
                                "updatedAt" = NOW()
                            FROM "Portfolio" p
                            WHERE p."ownerId" = u.id
                            AND p."stockId" = ${user.stock.id}
                            AND p."ownerId" != ${user.id}
                            AND p.shares > 0
                        `;
                    }

                    // 3. CORRECT EXTERNAL SUPPLIES (What the user owns)
                    // The user owns stocks in OTHER companies. We must decrement sharesOutstanding
                    const userPortfolios = await tx.portfolio.findMany({
                        where: { ownerId: user.id, shares: { gt: 0 } },
                        select: { stockId: true, shares: true }
                    });

                    if (userPortfolios.length > 0) {
                        const values = userPortfolios
                            .map(p => `('${p.stockId}', ${p.shares})`)
                            .join(', ');

                        await tx.$executeRawUnsafe(`
                            UPDATE "Stock" as s
                            SET "sharesOutstanding" = s."sharesOutstanding" - v.shares
                            FROM (VALUES ${values}) as v(id, shares)
                            WHERE s.id = v.id::text
                        `);
                    }

                    // 4. PURGE PORTFOLIOS
                    // Delete what the user owns AND who owns the user
                    await tx.portfolio.deleteMany({
                        where: {
                            OR: [
                                { ownerId: user.id },      // Investments held BY user
                                { stockId: user.stock?.id } // Investments held IN user
                            ]
                        }
                    });

                    // 5. RESET STOCK (If exists)
                    if (user.stock) {
                        await tx.stock.update({
                            where: { id: user.stock.id },
                            data: {
                                currentPrice: CONSTANTS.DEFAULT_STOCK_PRICE,
                                volatility: CONSTANTS.DEFAULT_VOLATILITY,
                                sharesOutstanding: 0,
                                frozenUntil: null,
                                totalShares: CONSTANTS.DEFAULT_TOTAL_SHARES,
                                updatedAt: new Date()
                            }
                        });
                    }

                    // 6. RESET USER
                    await tx.user.update({
                        where: { id: user.id },
                        data: {
                            balance: CONSTANTS.DEFAULT_BALANCE,
                            netWorth: CONSTANTS.DEFAULT_NET_WORTH,
                            isOptedOut: true,
                            bullhornUntil: null,
                            liquidLuckUntil: null,
                            rumorMillUntil: null,
                            jailedUntil: null,
                            lastActiveAt: new Date(),
                            updatedAt: new Date()
                        }
                    });
                });
            } else {
                // OPTING IN
                await prisma.user.update({
                    where: { discordId_guildId: { discordId: userId, guildId } },
                    data: { isOptedOut: false }
                });
            }

            // Update Cache
            await redisCache.set(cacheKey, isOptedOut ? '1' : '0', 'EX', CONSTANTS.CACHE_TTL_OPTOUT);

            // If opting out, remove from leaderboard cache immediately
            if (isOptedOut) {
                const user = await prisma.user.findUnique({
                    where: { discordId_guildId: { discordId: userId, guildId } },
                    select: { id: true }
                });
                if (user) {
                    await redisCache.zrem(`leaderboard:networth:${guildId}`, user.id);
                }
            }

            return true;
        } catch (error) {
            console.error(`Error setting opt-out status for ${userId}:`, error);
            await redisCache.del(cacheKey);
            return false;
        }
    }
}