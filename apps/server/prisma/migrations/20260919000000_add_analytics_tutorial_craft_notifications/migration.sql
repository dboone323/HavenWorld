-- Part 9B analytics + onboarding, plus crafting completion notifications.
-- Generated with: prisma migrate diff --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script
--
-- NOTE: the original version of this migration also contained
--   ALTER TABLE "crafting_queues" ADD COLUMN "notifiedAt" TIMESTAMP(3);
-- which could never apply: `crafting_queues` is created by no migration that
-- precedes this one, so `prisma migrate deploy` failed with
--   42P01 relation "crafting_queues" does not exist.
-- The crafts-notification column is now created together with the
-- `crafting_queues` table in 20260923170000_complete_game_schema.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "tutorialCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tutorialStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "welcomeBadgeAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "isSolo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTutorial" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "game_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "event" TEXT NOT NULL,
    "sessionId" TEXT,
    "roomId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_events_event_createdAt_idx" ON "game_events"("event", "createdAt");

-- CreateIndex
CREATE INDEX "game_events_userId_createdAt_idx" ON "game_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "game_events_sessionId_idx" ON "game_events"("sessionId");

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;