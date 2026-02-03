import prisma from '../prisma';

export class ShareholderService {
    /**
     * Returns the user who holds the majority of shares for a given stock.
     * Defined as the single portfolio holding the largest number of shares,
     * provided they hold more than 0 shares.
     * Returns null if no one holds shares or if the owner is the only holder (optional interpretation, 
     * but usually the owner holding their own stock doesn't count as "hostile" unless we strictly follow "majority").
     * 
     * The prompt says: "If a user acquires a significant percentage (e.g., >50% or simply the single largest holder) of another user's stock, they become the Majority Shareholder."
     * "simply the single largest holder" seems to be the rule.
     */
    static async getMajorityShareholder(stockId: string) {
        // Find the portfolio with the max shares for this stock
        const topPortfolio = await prisma.portfolio.findFirst({
            where: {
                stockId: stockId,
                shares: { gt: 0 }
            },
            orderBy: {
                shares: 'desc'
            },
            include: {
                owner: true
            }
        });

        if (!topPortfolio) return null;

        // We might want to check if there's a tie, but "single largest" implies if there's a tie, maybe no one is majority? 
        // Or just the first one found. Let's stick to the first one found for optimization unless specified otherwise.
        // Also, check if the majority shareholder is the stock owner themselves?
        // The prompt implies "of another user's stock". 
        // If the owner owns 1000 shares of their own stock, and someone else buys 500. Owner is majority.
        // But "Hostile Takeover" implies someone ELSE.
        // "If a user acquires ... of *another user's* stock".
        // Use logic: The majority shareholder must be someone OTHER than the stock owner?
        // Or maybe just return the top holder, and let the caller decide if it counts as "hostile".
        // But "Property of @BuyerName" implies it's someone else.
        // Let's retrieve the stock to check owner.

        const stock = await prisma.stock.findUnique({
            where: { id: stockId },
            select: { userId: true }
        });

        if (stock && topPortfolio.ownerId === stock.userId) {
            // The owner is the majority shareholder. This is normal status, not a takeover.
            return null;
        }

        return topPortfolio.owner;
    }
}
