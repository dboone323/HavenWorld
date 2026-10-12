-- Enable Supabase / PostgreSQL Row-Level Security (RLS) across all public tables.
-- The server connects via the service/owner role (which bypasses RLS), while
-- PostgREST/anon/authenticated client roles are locked out by default until
-- explicit policies are granted.

ALTER TABLE IF EXISTS "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."avatars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."inventories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."room_furniture" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."friends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."direct_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."invite_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."fish_catches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."fishing_leaderboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."room_decorators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."room_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."guestbook_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."tip_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."trade_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."daily_login_streaks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."gift_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."pets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."minigame_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."weekly_earnings_caps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."arcade_settlement_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."material_inventories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."crafting_queues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."achievements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."passport_frames" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."seasonal_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."seasonal_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."clubs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."club_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."daily_quest_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."gallery_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."photo_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."transaction_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."game_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."loft_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."marketplace_listings" ENABLE ROW LEVEL SECURITY;
