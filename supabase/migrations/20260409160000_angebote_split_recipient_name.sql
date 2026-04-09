-- Split Angebot recipient_name into first/last name (keep recipient_name for legacy).

ALTER TABLE public.angebote
  ADD COLUMN IF NOT EXISTS recipient_first_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_last_name  TEXT;

-- Backfill: treat existing recipient_name as last name for existing rows
UPDATE public.angebote
  SET recipient_last_name = recipient_name
  WHERE recipient_name IS NOT NULL
    AND recipient_last_name IS NULL;

