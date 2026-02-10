-- CreateIndex
CREATE INDEX "Portfolio_ownerId_shares_idx" ON "Portfolio"("ownerId", "shares" DESC);
