-- CreateIndex
CREATE INDEX "Portfolio_stockId_shares_idx" ON "Portfolio"("stockId", "shares" DESC);

-- CreateIndex
CREATE INDEX "Stock_currentPrice_idx" ON "Stock"("currentPrice" DESC);

-- CreateIndex
CREATE INDEX "Stock_updatedAt_idx" ON "Stock"("updatedAt");

-- CreateIndex
CREATE INDEX "User_netWorth_idx" ON "User"("netWorth" DESC);

-- CreateIndex
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");
