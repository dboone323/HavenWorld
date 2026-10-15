-- Migration: Atomic Furniture Placement & Pickup RPC Functions
-- Resolves Section 4.B: Encapsulate placing and picking up furniture inside a single PostgreSQL RPC function executed inside an atomic transaction.

CREATE OR REPLACE FUNCTION public.place_furniture_item(
    p_user_id UUID,
    p_room_id TEXT,
    p_item_id TEXT,
    p_x NUMERIC,
    p_y NUMERIC,
    p_rotation INT DEFAULT 0,
    p_elevation NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_inv_record RECORD;
    v_new_furniture_id TEXT;
    v_result JSONB;
BEGIN
    -- 1. Check and decrement inventory atomically with row lock
    SELECT * INTO v_inv_record
    FROM public.user_inventory
    WHERE user_id = p_user_id AND item_id = p_item_id
    FOR UPDATE;

    IF NOT FOUND OR v_inv_record.quantity < 1 THEN
        RAISE EXCEPTION 'ITEM_NOT_OWNED: Item % not owned or insufficient quantity in user_inventory', p_item_id;
    END IF;

    IF v_inv_record.quantity = 1 THEN
        DELETE FROM public.user_inventory WHERE id = v_inv_record.id;
    ELSE
        UPDATE public.user_inventory
        SET quantity = quantity - 1
        WHERE id = v_inv_record.id;
    END IF;

    -- 2. Insert into placed_furniture
    v_new_furniture_id := 'f_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    INSERT INTO public.placed_furniture (
        id, room_id, item_type, grid_x, grid_y, rotation, elevation
    ) VALUES (
        v_new_furniture_id, p_room_id, p_item_id, p_x, p_y, p_rotation, p_elevation
    );

    v_result := jsonb_build_object(
        'id', v_new_furniture_id,
        'room_id', p_room_id,
        'item_id', p_item_id,
        'x', p_x,
        'y', p_y,
        'rotation', p_rotation,
        'elevation', p_elevation
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.pickup_furniture_item(
    p_user_id UUID,
    p_room_id TEXT,
    p_furniture_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_furn RECORD;
    v_result JSONB;
BEGIN
    -- 1. Find and delete placed furniture atomically with row lock
    SELECT * INTO v_furn
    FROM public.placed_furniture
    WHERE id = p_furniture_id AND room_id = p_room_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FURNITURE_NOT_FOUND: Furniture item % not found in room %', p_furniture_id, p_room_id;
    END IF;

    DELETE FROM public.placed_furniture WHERE id = p_furniture_id;

    -- 2. Return item to user inventory atomically
    INSERT INTO public.user_inventory (user_id, item_id, quantity)
    VALUES (p_user_id, v_furn.item_type, 1)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = public.user_inventory.quantity + 1;

    v_result := jsonb_build_object(
        'id', p_furniture_id,
        'item_id', v_furn.item_type,
        'room_id', p_room_id
    );

    RETURN v_result;
END;
$$;
