-- Adds column_order to trip_presets so saved views can restore the
-- exact column sequence the admin arranged, not just visibility.
ALTER TABLE public.trip_presets
  ADD COLUMN IF NOT EXISTS column_order jsonb NOT NULL DEFAULT '[]';
