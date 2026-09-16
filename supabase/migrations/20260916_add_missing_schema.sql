-- =============================================================================
-- HavenWorld — Additive migration: bring the LIVE Supabase project in line with
-- the schema expected by src/server/db.ts.
--
-- WHY THIS FILE EXISTS
--   The live project (ruphxzwfgwtrheprvpdq) predates four features. Probing the
--   REST schema cache on 2026-09-16 reported:
--     ✗ profiles.password_hash              -> column does not exist
--     ✗ placed_furniture.elevation          -> column does not exist
--     ✗ user_friends                        -> table not in schema cache
--     ✗ messages                            -> table not in schema cache
--   Consequence: in Supabase mode, account signup/login, loft furniture load,
--   the friends system and private messaging all fail.
--
--   DO NOT run supabase/schema.sql instead — it begins with
--   `DROP TABLE ... CASCADE` and would DESTROY existing player data
--   (profiles / rooms / placed_furniture / inventory).
--
-- SAFETY: every statement is idempotent (IF NOT EXISTS) and additive only.
-- Apply via: Supabase Dashboard -> SQL Editor -> paste -> Run
-- (or: psql "$DATABASE_URL" -f supabase/migrations/20260916_add_missing_schema.sql)
-- =============================================================================

-- 1. profiles.password_hash (account authentication for guest/legacy accounts)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. placed_furniture.elevation (multi-layer surface parenting / z-ordering)
ALTER TABLE public.placed_furniture
    ADD COLUMN IF NOT EXISTS elevation FLOAT DEFAULT 0;

-- 3. user_friends (friend requests + accepted friendships)
CREATE TABLE IF NOT EXISTS public.user_friends (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status VARCHAR(16) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    responded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT user_friends_pair_unique UNIQUE (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS user_friends_user_id_idx ON public.user_friends (user_id);
CREATE INDEX IF NOT EXISTS user_friends_friend_id_idx ON public.user_friends (friend_id);

-- 4. messages (private messaging between friends)
CREATE TABLE IF NOT EXISTS public.messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_recipient_idx ON public.messages (recipient_id, sent_at DESC);

-- 5. Row Level Security
--    NOTE: the server currently authenticates to Supabase with the *anon*
--    publishable key (SUPABASE_SERVICE_ROLE_KEY is not set), so these policies
--    necessarily mirror the permissive style already used by supabase/schema.sql.
--    Tighten to auth.uid()-scoped policies once the service_role key is adopted
--    server-side. See docs/PLAN_LINUX_SERVER_AGENT.md Step 3.
ALTER TABLE public.user_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own friend relationships" ON public.user_friends;
CREATE POLICY "Users can manage own friend relationships"
    ON public.user_friends FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages"
    ON public.messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages"
    ON public.messages FOR INSERT WITH CHECK (true);

-- =============================================================================
-- Verification (should return no rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='profiles' AND column_name='password_hash';
-- =============================================================================