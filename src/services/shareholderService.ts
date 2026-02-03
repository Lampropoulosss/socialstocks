import prisma from '../prisma';

export class ShareholderService {
    static async getMajorityShareholder(stockId: string) {
        const topPortfolio = await prisma.portfolio.findFirst({
            where: {
                stockId: stockId,
                shares: { gt: 0 }
            },
            orderBy: {
                shares: 'desc'
            },
            select: {
                ownerId: true,
                owner: {
                    select: { username: true, id: true, discordId: true }
                }
            }
        });

        if (!topPortfolio) return null;

        const stock = await prisma.stock.findUnique({
            where: { id: stockId },
            select: { userId: true }
        });

        if (stock && topPortfolio.ownerId === stock.userId) {
            return null;
        }

        return topPortfolio.owner;
    }
}
