-- Avatar gender for the wardrobe customizer ('male' | 'female' | 'unspecified').
-- Existing rows keep the neutral default so no avatar is silently re-shaped.
ALTER TABLE "avatars" ADD COLUMN "gender" TEXT NOT NULL DEFAULT 'unspecified';