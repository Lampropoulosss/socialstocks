import { redisCache } from '../redis';
import prisma from '../prisma';

export enum ItemType {
    BULLHORN = 'BULLHORN',
    PRICE_FREEZE = 'PRICE_FREEZE'
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
        description: '2x Activity Points (30 mins)',
        price: 200,
        durationMinutes: 30,
        cooldownMinutes: 60 // "COOLDOWN FOR THE TARGET USER AND THE USER SENDING COMMAND" - let's assume 30m duration + some cooldown. Prompt says "UNTIL THE COOLDOWN IS OVER". Let's say cooldown is equal to duration? Or longer. Let's make it 60 mins to be safe/balanced.
    },
    {
        id: ItemType.PRICE_FREEZE,
        name: 'Price Freeze',
        description: 'Prevent stock price drop (3 hours)',
        price: 1000,
        durationMinutes: 180,
        cooldownMinutes: 360 // 6 hours
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

        if (buyer.balance.toNumber() < item.price) {
            throw new Error(`Insufficient funds. You need $${item.price}.`);
        }

        // 2. Check Cooldowns and Active Effects

        // Check Active Effects in DB
        const now = new Date();
        if (itemId === ItemType.BULLHORN) {
            if (target.bullhornUntil && target.bullhornUntil > now) {
                throw new Error("This effect is already active on the target.");
            }
        } else if (itemId === ItemType.PRICE_FREEZE) {
            if (target.stock?.frozenUntil && target.stock.frozenUntil > now) {
                throw new Error("This stock is already frozen.");
            }
        }

        const getKeys = () => {
            // We only need cooldown keys now
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
