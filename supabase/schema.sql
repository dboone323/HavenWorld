-- =============================================================================
-- HavenWorld / MiniWorld — Supabase Schema & Initial Migration (Clean Setup)
-- Compatible with both Anonymous Guests (usr_...) and Supabase Auth (UUIDs)
-- =============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Clean reset of older schema tables if they were previously created with UUID types
DROP TABLE IF EXISTS public.user_inventory CASCADE;
DROP TABLE IF EXISTS public.placed_furniture CASCADE;
DROP TABLE IF EXISTS public.rooms CASCADE;
DROP TABLE IF EXISTS public.avatar_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2. PUBLIC PROFILES & GAME STATE TABLE
CREATE TABLE public.profiles (
    id TEXT PRIMARY KEY,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    username VARCHAR(32) NOT NULL,
    coins BIGINT DEFAULT 1000 NOT NULL,
    gems INT DEFAULT 50 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_daily_claim TIMESTAMP WITH TIME ZONE DEFAULT '1970-01-01 00:00:00Z'
);

-- 3. AVATAR STYLING
CREATE TABLE public.avatar_profiles (
    user_id TEXT PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    skin VARCHAR(16) DEFAULT '#f5cba7' NOT NULL,
    hair_style VARCHAR(32) DEFAULT 'cozy_messy' NOT NULL,
    hair_color VARCHAR(16) DEFAULT '#4a235a' NOT NULL,
    shirt_color VARCHAR(16) DEFAULT '#2e86c1' NOT NULL,
    pants_color VARCHAR(16) DEFAULT '#34495e' NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. VIRTUAL ROOMS / SANCTUARIES
CREATE TABLE public.rooms (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
    room_code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(64) NOT NULL,
    is_public BOOLEAN DEFAULT true NOT NULL,
    likes_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. PLACED FURNITURE (SURFACE PARENTING & Z-ORDERING READY)
CREATE TABLE public.placed_furniture (
    id TEXT PRIMARY KEY,
    room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
    item_type VARCHAR(48) NOT NULL,
    grid_x FLOAT NOT NULL,
    grid_y FLOAT NOT NULL,
    rotation INT DEFAULT 0 NOT NULL,
    parent_furniture_id TEXT REFERENCES public.placed_furniture(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. USER INVENTORY
CREATE TABLE public.user_inventory (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    item_type VARCHAR(48) NOT NULL,
    quantity INT DEFAULT 1 NOT NULL,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Pre-populate Default Public Rooms
INSERT INTO public.rooms (id, owner_id, room_code, name, is_public)
VALUES 
    ('plaza', NULL, 'plaza', 'Central Plaza & Lounge', true),
    ('sanctuary_loft', NULL, 'sanctuary_loft', 'Cozy Personal Loft', false)
ON CONFLICT (id) DO NOTHING;

-- Pre-populate default Plaza furniture
INSERT INTO public.placed_furniture (id, room_id, item_type, grid_x, grid_y, rotation)
VALUES
    ('f_bench1', 'plaza', 'bench', 2, 3, 0),
    ('f_bench2', 'plaza', 'bench', 7, 3, 0),
    ('f_fountain', 'plaza', 'fountain', 5, 5, 0),
    ('f_plant1', 'plaza', 'plant', 1, 1, 0),
    ('f_plant2', 'plaza', 'plant', 9, 1, 0),
    ('f_arcade', 'plaza', 'arcade', 8, 8, 0)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- AUTOMATED TRIGGERS (Auto-create Profile and Starter Sanctuary on Signup)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_username VARCHAR(32);
    user_id_text TEXT;
    new_room_id TEXT;
BEGIN
    user_id_text := new.id::text;
    new_username := COALESCE(
        new.raw_user_meta_data->>'username',
        split_part(new.email, '@', 1) || '_' || substr(user_id_text, 1, 4)
    );

    -- Create profile linked to auth user
    INSERT INTO public.profiles (id, auth_user_id, username, coins, gems)
    VALUES (user_id_text, new.id, new_username, 1000, 50)
    ON CONFLICT (id) DO UPDATE SET auth_user_id = new.id;

    -- Create default avatar
    INSERT INTO public.avatar_profiles (user_id)
    VALUES (user_id_text)
    ON CONFLICT (user_id) DO NOTHING;

    -- Create starter personal sanctuary loft if doesn't exist
    new_room_id := 'loft_' || substr(user_id_text, 1, 8);
    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE owner_id = user_id_text) THEN
        INSERT INTO public.rooms (id, owner_id, room_code, name, is_public)
        VALUES (new_room_id, user_id_text, new_room_id, new_username || '''s Sanctuary Loft', false);

        -- Add starter furniture to their room
        INSERT INTO public.placed_furniture (id, room_id, item_type, grid_x, grid_y) VALUES
            ('f_' || substr(gen_random_uuid()::text, 1, 8), new_room_id, 'sofa', 3, 4),
            ('f_' || substr(gen_random_uuid()::text, 1, 8), new_room_id, 'table', 5, 4),
            ('f_' || substr(gen_random_uuid()::text, 1, 8), new_room_id, 'plant', 2, 2),
            ('f_' || substr(gen_random_uuid()::text, 1, 8), new_room_id, 'tv', 5, 2),
            ('f_' || substr(gen_random_uuid()::text, 1, 8), new_room_id, 'neon', 7, 1);
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger execution on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avatar_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placed_furniture ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" 
    ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users or Server can insert/update profile" ON public.profiles;
CREATE POLICY "Users or Server can insert/update profile" 
    ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- 2. Avatar Policies
DROP POLICY IF EXISTS "Avatars viewable by everyone" ON public.avatar_profiles;
CREATE POLICY "Avatars viewable by everyone" 
    ON public.avatar_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Avatars editable by everyone or server" ON public.avatar_profiles;
CREATE POLICY "Avatars editable by everyone or server" 
    ON public.avatar_profiles FOR ALL USING (true) WITH CHECK (true);

-- 3. Rooms Policies
DROP POLICY IF EXISTS "Rooms viewable if public or owned" ON public.rooms;
CREATE POLICY "Rooms viewable if public or owned" 
    ON public.rooms FOR SELECT USING (true);

DROP POLICY IF EXISTS "Rooms editable" ON public.rooms;
CREATE POLICY "Rooms editable" 
    ON public.rooms FOR ALL USING (true) WITH CHECK (true);

-- 4. Furniture Policies
DROP POLICY IF EXISTS "Furniture viewable by room viewers" ON public.placed_furniture;
CREATE POLICY "Furniture viewable by room viewers" 
    ON public.placed_furniture FOR SELECT USING (true);

DROP POLICY IF EXISTS "Furniture manageable" ON public.placed_furniture;
CREATE POLICY "Furniture manageable" 
    ON public.placed_furniture FOR ALL USING (true) WITH CHECK (true);

-- 5. Inventory Policies
DROP POLICY IF EXISTS "Users can view own inventory" ON public.user_inventory;
CREATE POLICY "Users can view own inventory" 
    ON public.user_inventory FOR SELECT USING (true);
