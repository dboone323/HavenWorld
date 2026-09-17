-- Apply before deploying Track 2. Do not invent dates for existing accounts.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS registered_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS identity_json jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION public.preserve_registration_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.registered_at IS NOT NULL AND NEW.registered_at IS DISTINCT FROM OLD.registered_at THEN
    RAISE EXCEPTION 'registration date is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_registered_at_immutable ON public.profiles;
CREATE TRIGGER profiles_registered_at_immutable BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.preserve_registration_date();
