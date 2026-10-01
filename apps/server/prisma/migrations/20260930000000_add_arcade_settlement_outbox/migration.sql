-- CreateTable
CREATE TABLE "arcade_settlement_outbox" (
    "matchId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "player1Id" TEXT NOT NULL,
    "player2Id" TEXT NOT NULL,
    "winnerId" TEXT,
    "isDraw" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "weeklyRemaining" INTEGER NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "arcade_settlement_outbox_pkey" PRIMARY KEY ("matchId")
);

-- CreateIndex
CREATE INDEX "arcade_settlement_outbox_settledAt_finishedAt_idx" ON "arcade_settlement_outbox"("settledAt", "finishedAt");

