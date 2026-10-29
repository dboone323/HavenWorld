-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_addresseeId_status_idx" ON "friends"("addresseeId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "room_furniture_roomId_idx" ON "room_furniture"("roomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rooms_ownerId_idx" ON "rooms"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rooms_isPublic_isActive_idx" ON "rooms"("isPublic", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users"("role");
