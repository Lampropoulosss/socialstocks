import { redisCache } from '../redis';
import prisma from '../prisma';

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
    price: number;
    durationMinutes: number;
    cooldownMinutes: number;
}

export const SHOP_ITEMS: ShopItem[] = [
    {
        id: ItemType.BULLHORN,
        name: 'The Bullhorn',
        description: '2x Activity Points (20 mins)',
        price: 800, // Reduced from 2500 (Accessible after ~80 messages)
        durationMinutes: 20,
        cooldownMinutes: 120
    },
    {
        id: ItemType.PRICE_FREEZE,
        name: 'Night Shield',
        description: 'Prevent stock price drop (8 hours)',
        price: 2000, // Reduced from 5000 (Mid-tier investment)
        durationMinutes: 480,
        cooldownMinutes: 1440
    },
    {
        id: ItemType.RUMOR_MILL,
        name: 'Rumor Mill',
        description: 'Drop stock price by 5% and reduce growth by 20% (1 hour)',
        price: 4500,
        durationMinutes: 60,
        cooldownMinutes: 240
    },
    {
        id: ItemType.LIQUID_LUCK,
        name: 'Liquid Luck',
        description: 'Boost Volatility (30 Mins)',
        price: 7500, // Reduced from 15000 (High-tier, but attainable)
        durationMinutes: 30,
        cooldownMinutes: 360
    }
];

export class ItemService {

    static getItems() {
        return SHOP_ITEMS;
    }

    static async buyItem(buyerDiscordId: string, guildId: string, itemId: ItemType, targetDiscordId: string) {
        // 1. Validate Buyer and Target
        const buyer = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: buyerDiscordId, guildId } }
        });

        if (!buyer) throw new Error("You don't have a profile.");

        const target = await prisma.user.findUnique({
            where: { discordId_guildId: { discordId: targetDiscordId, guildId } },
            include: { stock: true }
        });

        if (!target || !target.stock) throw new Error("Target user not found or has no stock.");

        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) throw new Error("Invalid item.");

        // 2. Check Cooldowns and Active Effects
        const now = new Date();
        if (itemId === ItemType.BULLHORN) {
            if (target.bullhornUntil && target.bullhornUntil > now) {
                throw new Error("This effect is already active on the target.");
            }
        } else if (itemId === ItemType.PRICE_FREEZE) {
            if (target.stock?.frozenUntil && target.stock.frozenUntil > now) {
                throw new Error("This stock is already frozen.");
            }
        } else if (itemId === ItemType.LIQUID_LUCK) {
            if (target.liquidLuckUntil && target.liquidLuckUntil > now) {
                throw new Error("This effect is already active on the target.");
            }
        } else if (itemId === ItemType.RUMOR_MILL) {
            if (target.rumorMillUntil && target.rumorMillUntil > now) {
                throw new Error("This user is already suffering from rumors.");
            }
            // Cannot use on yourself
            if (buyer.id === target.id) {
                throw new Error("You cannot start rumors about yourself.");
            }
        }

        const getKeys = () => {
            return {
                cooldownBuyer: `cooldown:${itemId.toLowerCase()}:buyer:${buyer.discordId}:${buyer.guildId}`,
                cooldownTarget: `cooldown:${itemId.toLowerCase()}:target:${target.discordId}:${target.guildId}`
            };
        };

        const keys = getKeys();

        // Check Cooldowns
        const cdBuyer = await redisCache.get(keys.cooldownBuyer);
        if (cdBuyer) {
            const ttl = await redisCache.ttl(keys.cooldownBuyer);
            throw new Error(`You are on cooldown for this item. Try again in ${Math.ceil(ttl / 60)}m.`);
        }

        const cdTarget = await redisCache.get(keys.cooldownTarget);
        if (cdTarget) {
            const ttl = await redisCache.ttl(keys.cooldownTarget);
            throw new Error(`The target is on cooldown for this item. Try again in ${Math.ceil(ttl / 60)}m.`);
        }

        // 3. Process Transaction & Apply Effect
        const durationSec = item.durationMinutes * 60;
        const cooldownSec = item.cooldownMinutes * 60;
        const activeUntil = new Date(now.getTime() + durationSec * 1000);

        await prisma.$transaction(async (tx) => {
            const freshBuyer = await tx.user.findUniqueOrThrow({ where: { id: buyer.id } });
            if (freshBuyer.balance.toNumber() < item.price) throw new Error(`Insufficient funds. You need $${item.price}.`);

            await tx.user.update({
                where: { id: buyer.id },
                data: { balance: { decrement: item.price } }
            });

            if (itemId === ItemType.PRICE_FREEZE) {
                await tx.stock.update({
                    where: { id: target.stock!.id },
                    data: { frozenUntil: activeUntil }
                });
            } else if (itemId === ItemType.BULLHORN) {
                await tx.user.update({
                    where: { id: target.id },
                    data: { bullhornUntil: activeUntil }
                });
            } else if (itemId === ItemType.LIQUID_LUCK) {
                await tx.user.update({
                    where: { id: target.id },
                    data: { liquidLuckUntil: activeUntil }
                });
            } else if (itemId === ItemType.RUMOR_MILL) {
                // 1. Apply the Debuff Timer
                await tx.user.update({
                    where: { id: target.id },
                    data: { rumorMillUntil: activeUntil }
                });

                // 2. Instant 5% Price Drop
                // Note: We use executeRaw for decimal multiplication safety or JS calculation
                const currentPrice = target.stock!.currentPrice.toNumber();
                const rawNewPrice = Math.max(1.00, currentPrice * 0.95);
                // Convert to fixed string then back to number to strip extra decimals
                const newPrice = parseFloat(rawNewPrice.toFixed(2));

                await tx.stock.update({
                    where: { id: target.stock!.id },
                    data: { currentPrice: newPrice }
                });
            }
        });

        // 4. Apply Redis Cooldowns
        await redisCache.set(keys.cooldownBuyer, '1', 'EX', cooldownSec);
        await redisCache.set(keys.cooldownTarget, '1', 'EX', cooldownSec);

        return {
            itemName: item.name,
            price: item.price,
            targetName: target.username,
            duration: item.durationMinutes
        };
    }
}
