-- CreateEnum
CREATE TYPE "RoomPrivacy" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'PASSWORD_PROTECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PetType" AS ENUM ('CAT', 'DOG', 'BABY_DRAGON');

-- CreateEnum
CREATE TYPE "PetState" AS ENUM ('IDLE', 'WANDER', 'FOLLOW', 'SLEEP', 'REACT');

-- CreateEnum
CREATE TYPE "ClubRole" AS ENUM ('OWNER', 'OFFICER', 'MEMBER');

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "bodyTypeVal" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "bottomColor" TEXT NOT NULL DEFAULT '#2E8B57',
ADD COLUMN     "buildVal" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "heightVal" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "topColor" TEXT NOT NULL DEFAULT '#4169E1';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "assetUrl" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "room_furniture" ADD COLUMN     "scaleX" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "scaleY" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "scaleZ" DOUBLE PRECISION NOT NULL DEFAULT 1,
ALTER COLUMN "x" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "y" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "z" SET DEFAULT 0,
ALTER COLUMN "z" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "rotation" SET DEFAULT 0,
ALTER COLUMN "rotation" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "accessMode" TEXT NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "awayMessage" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "moodPreset" TEXT NOT NULL DEFAULT 'day',
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "privacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "havenCoins" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "havenGems" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVIP" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vipSince" TIMESTAMP(3),
ADD COLUMN     "weeklyEarnings" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fish_catches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "coinsEarned" INTEGER NOT NULL,
    "caughtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fish_catches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fishing_leaderboards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fishing_leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_decorators" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_decorators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_access_logs" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guestbook_entries" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "message" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guestbook_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_transactions" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_logs" (
    "id" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "initiatorItems" JSONB NOT NULL,
    "receiverItems" JSONB NOT NULL,
    "initiatorCoins" INTEGER NOT NULL DEFAULT 0,
    "receiverCoins" INTEGER NOT NULL DEFAULT 0,
    "status" "TradeStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "trade_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_login_streaks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastLoginDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_login_streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_transactions" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "message" VARCHAR(140),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "petType" "PetType" NOT NULL,
    "name" VARCHAR(16) NOT NULL,
    "happiness" INTEGER NOT NULL DEFAULT 100,
    "hunger" INTEGER NOT NULL DEFAULT 100,
    "accessoryIds" JSONB NOT NULL DEFAULT '[]',
    "lastFedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minigame_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "coinsEarned" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "minigame_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_earnings_caps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "earned" INTEGER NOT NULL DEFAULT 0,
    "weekOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_earnings_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_inventories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scrapMetal" INTEGER NOT NULL DEFAULT 0,
    "timber" INTEGER NOT NULL DEFAULT 0,
    "fabric" INTEGER NOT NULL DEFAULT 0,
    "crystalShard" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "material_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crafting_queues" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "crafting_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stamp" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passport_frames" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "passport_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "rewards" JSONB NOT NULL,

    CONSTRAINT "seasonal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "currency" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seasonal_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "motto" VARCHAR(80),
    "tag" VARCHAR(5),
    "ownerId" TEXT NOT NULL,
    "roomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_members" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_quest_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "goal" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "rewardCoins" INTEGER NOT NULL,
    "rewardGems" INTEGER NOT NULL DEFAULT 0,
    "questDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_quest_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_photos" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" VARCHAR(80),
    "likes" INTEGER NOT NULL DEFAULT 0,
    "roomName" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gallery_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_likes" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "photo_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" TEXT,
    "ip" TEXT NOT NULL DEFAULT 'unknown',
    "userAgent" TEXT NOT NULL DEFAULT 'unknown',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_logs" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "receiverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loft_access" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loft_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fish_catches_userId_caughtAt_idx" ON "fish_catches"("userId", "caughtAt");

-- CreateIndex
CREATE INDEX "fishing_leaderboards_weekOf_weightLbs_idx" ON "fishing_leaderboards"("weekOf", "weightLbs");

-- CreateIndex
CREATE UNIQUE INDEX "fishing_leaderboards_userId_weekOf_key" ON "fishing_leaderboards"("userId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "room_decorators_roomId_userId_key" ON "room_decorators"("roomId", "userId");

-- CreateIndex
CREATE INDEX "room_access_logs_roomId_visitedAt_idx" ON "room_access_logs"("roomId", "visitedAt");

-- CreateIndex
CREATE INDEX "guestbook_entries_roomId_createdAt_idx" ON "guestbook_entries"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "tip_transactions_receiverId_createdAt_idx" ON "tip_transactions"("receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "trade_logs_initiatorId_createdAt_idx" ON "trade_logs"("initiatorId", "createdAt");

-- CreateIndex
CREATE INDEX "trade_logs_receiverId_createdAt_idx" ON "trade_logs"("receiverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_login_streaks_userId_key" ON "daily_login_streaks"("userId");

-- CreateIndex
CREATE INDEX "gift_transactions_receiverId_createdAt_idx" ON "gift_transactions"("receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "pets_ownerId_idx" ON "pets"("ownerId");

-- CreateIndex
CREATE INDEX "minigame_sessions_userId_gameType_completedAt_idx" ON "minigame_sessions"("userId", "gameType", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_earnings_caps_userId_gameType_weekOf_key" ON "weekly_earnings_caps"("userId", "gameType", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "material_inventories_userId_key" ON "material_inventories"("userId");

-- CreateIndex
CREATE INDEX "crafting_queues_userId_claimed_idx" ON "crafting_queues"("userId", "claimed");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_userId_stamp_key" ON "achievements"("userId", "stamp");

-- CreateIndex
CREATE UNIQUE INDEX "passport_frames_userId_key" ON "passport_frames"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "seasonal_progress_userId_eventId_key" ON "seasonal_progress"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_name_key" ON "clubs"("name");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_roomId_key" ON "clubs"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "club_members_userId_key" ON "club_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_quest_progress_userId_questId_questDate_key" ON "daily_quest_progress"("userId", "questId", "questDate");

-- CreateIndex
CREATE INDEX "gallery_photos_createdAt_idx" ON "gallery_photos"("createdAt");

-- CreateIndex
CREATE INDEX "gallery_photos_likes_idx" ON "gallery_photos"("likes");

-- CreateIndex
CREATE UNIQUE INDEX "photo_likes_photoId_userId_key" ON "photo_likes"("photoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminId_idx" ON "admin_audit_logs"("adminId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs"("action");

-- CreateIndex
CREATE INDEX "transaction_logs_receiverId_idx" ON "transaction_logs"("receiverId");

-- CreateIndex
CREATE INDEX "transaction_logs_senderId_idx" ON "transaction_logs"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "loft_access_roomId_userId_key" ON "loft_access"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "items_name_key" ON "items"("name");

-- AddForeignKey
ALTER TABLE "fish_catches" ADD CONSTRAINT "fish_catches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fishing_leaderboards" ADD CONSTRAINT "fishing_leaderboards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_decorators" ADD CONSTRAINT "room_decorators_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_decorators" ADD CONSTRAINT "room_decorators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_access_logs" ADD CONSTRAINT "room_access_logs_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guestbook_entries" ADD CONSTRAINT "guestbook_entries_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guestbook_entries" ADD CONSTRAINT "guestbook_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_transactions" ADD CONSTRAINT "tip_transactions_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_transactions" ADD CONSTRAINT "tip_transactions_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_logs" ADD CONSTRAINT "trade_logs_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_logs" ADD CONSTRAINT "trade_logs_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_login_streaks" ADD CONSTRAINT "daily_login_streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_sessions" ADD CONSTRAINT "minigame_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_earnings_caps" ADD CONSTRAINT "weekly_earnings_caps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inventories" ADD CONSTRAINT "material_inventories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crafting_queues" ADD CONSTRAINT "crafting_queues_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passport_frames" ADD CONSTRAINT "passport_frames_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_progress" ADD CONSTRAINT "seasonal_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_progress" ADD CONSTRAINT "seasonal_progress_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "seasonal_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_quest_progress" ADD CONSTRAINT "daily_quest_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_photos" ADD CONSTRAINT "gallery_photos_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_likes" ADD CONSTRAINT "photo_likes_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "gallery_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_likes" ADD CONSTRAINT "photo_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_logs" ADD CONSTRAINT "transaction_logs_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_logs" ADD CONSTRAINT "transaction_logs_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loft_access" ADD CONSTRAINT "loft_access_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loft_access" ADD CONSTRAINT "loft_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

