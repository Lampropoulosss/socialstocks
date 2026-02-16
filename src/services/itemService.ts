import { redisCache } from '../redis';
import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

// Helper for Inputs
type DecimalLike = number | { toNumber(): number } | InstanceType<typeof Decimal>;

export enum ItemType {
    BULLHORN = 'BULLHORN',
    PRICE_FREEZE = 'PRICE_FREEZE',
    RUMOR_MILL = 'RUMOR_MILL',
    LIQUID_LUCK = 'LIQUID_LUCK'
}

export interface ShopItem {
    id: ItemType;
    name: string;
    description: string;
    basePrice: number;
    wealthPercent: number;
    durationMinutes: number;
    cooldownMinutes: number;
}

export const SHOP_ITEMS: ShopItem[] = [
    {
        id: ItemType.BULLHORN,
        name: 'The Bullhorn',
        description: '2x Activity Points (20 mins)',
        basePrice: 800,
        wealthPercent: 0.01,
        durationMinutes: 20,
        cooldownMinutes: 120
    },
    {
        id: ItemType.PRICE_FREEZE,
        name: 'Night Shield',
        description: 'Prevent stock price drop (8 hours)',
        basePrice: 2000,
        wealthPercent: 0.02,
        durationMinutes: 480,
        cooldownMinutes: 1440
    },
    {
        id: ItemType.RUMOR_MILL,
        name: 'Rumor Mill',
        description: 'Target drops 5% value & -20% growth (1 hr)',
        basePrice: 4500,
        wealthPercent: 0.05,
        durationMinutes: 60,
        cooldownMinutes: 240
    },
    {
        id: ItemType.LIQUID_LUCK,
        name: 'Liquid Luck',
        description: 'Boost Volatility (30 Mins)',
        basePrice: 7500,
        wealthPercent: 0.03,
        durationMinutes: 30,
        cooldownMinutes: 360
    }
];

export class ItemService {

    static getItems() {
        return SHOP_ITEMS;
    }

    static calculateItemCost(item: ShopItem, netWorth: DecimalLike): number {
        const nw = typeof netWorth === 'number' ? netWorth : netWorth.toNumber();
        const wealthCost = nw * item.wealthPercent;
        return Math.floor(Math.max(item.basePrice, wealthCost));
    }

    static async buyItem(buyerId: string, guildId: string, itemId: ItemType, targetId: string) {
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) throw new Error("Invalid item.");

        // 1. FAST FAIL: Redis Cooldowns
        const keys = {
            buyer: `cooldown:${itemId}:${buyerId}:${guildId}`,
            target: `cooldown:${itemId}:${targetId}:${guildId}`
        };
        const [cdBuyer, cdTarget] = await Promise.all([
            redisCache.get(keys.buyer),
            redisCache.get(keys.target)
        ]);
        if (cdBuyer) throw new Error(`You are on cooldown.`);
        if (cdTarget) throw new Error(`Target is on cooldown.`);

        // 2. QUERY 1: Fetch Buyer & Portfolio
        const buyer = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: buyerId, guildId } },
            include: {
                portfolio: { include: { stock: { select: { currentPrice: true } } } }
            }
        });

        if (!buyer) throw new Error("User not found.");

        if (itemId === ItemType.RUMOR_MILL && buyer.discordId === targetId) {
            throw new Error("You cannot use Rumor Mill on yourself.");
        }

        let portfolioValue = new Decimal(0);
        for (const p of buyer.portfolio) {
            portfolioValue = portfolioValue.plus(
                new Decimal(p.stock.currentPrice.toString()).times(p.shares.toString())
            );
        }

        const balance = new Decimal(buyer.balance.toString());
        const netWorth = balance.plus(portfolioValue);
        const cost = this.calculateItemCost(item, netWorth);

        if (balance.lessThan(cost)) {
            throw new Error(`Insufficient funds. Cost: $${cost.toLocaleString()}`);
        }

        // 3. QUERY 2: Atomic Transaction
        return await prisma.$transaction(async (tx) => {
            // Deduct Money
            await tx.user.update({
                where: { id: buyer.id },
                data: { balance: { decrement: cost } }
            });

            const now = new Date();
            const activeUntil = new Date(now.getTime() + item.durationMinutes * 60000);
            let result: Prisma.BatchPayload = { count: 0 };

            if (itemId === ItemType.BULLHORN) {
                result = await tx.user.updateMany({
                    where: {
                        discordId: targetId,
                        guildId,
                        OR: [{ bullhornUntil: null }, { bullhornUntil: { lt: now } }]
                    },
                    data: { bullhornUntil: activeUntil }
                });
            }
            else if (itemId === ItemType.PRICE_FREEZE) {
                result = await tx.stock.updateMany({
                    where: {
                        user: { discordId: targetId, guildId },
                        OR: [{ frozenUntil: null }, { frozenUntil: { lt: now } }]
                    },
                    data: { frozenUntil: activeUntil }
                });
            }
            else if (itemId === ItemType.LIQUID_LUCK) {
                result = await tx.user.updateMany({
                    where: {
                        discordId: targetId,
                        guildId,
                        OR: [{ liquidLuckUntil: null }, { liquidLuckUntil: { lt: now } }]
                    },
                    data: { liquidLuckUntil: activeUntil }
                });
            }
            else if (itemId === ItemType.RUMOR_MILL) {
                const targetStock = await tx.stock.findFirst({
                    where: { user: { discordId: targetId, guildId } }
                });

                if (!targetStock) throw new Error("Target has no stock to crash.");

                result = await tx.user.updateMany({
                    where: {
                        id: targetStock.userId,
                        OR: [{ rumorMillUntil: null }, { rumorMillUntil: { lt: now } }]
                    },
                    data: { rumorMillUntil: activeUntil }
                });

                if (result.count > 0) {
                    const currentPrice = new Decimal(targetStock.currentPrice.toString());
                    const newPrice = Decimal.max(10.00, currentPrice.times(0.95));
                    await tx.stock.update({
                        where: { id: targetStock.id },
                        data: { currentPrice: newPrice.toNumber() }
                    });
                }
            }

            if (result.count === 0) {
                throw new Error("Target is protected, invalid, or already has this effect.");
            }

            // Redis Set
            await redisCache.set(keys.buyer, '1', 'EX', item.cooldownMinutes * 60);
            await redisCache.set(keys.target, '1', 'EX', item.cooldownMinutes * 60);

            return {
                itemName: item.name,
                price: cost,
                targetId: targetId,
                duration: item.durationMinutes
            };
        });
    }
}