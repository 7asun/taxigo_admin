-- Trip-only PDF snapshot (driver, Hin/Rück), frozen at invoice creation — §14 UStG.
-- Kept separate from price_resolution_snapshot. Nullable for legacy rows.

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS trip_meta_snapshot jsonb NULL;

COMMENT ON COLUMN public.invoice_line_items.trip_meta_snapshot IS
  'Frozen trip fields for PDF (driver_name, direction) at invoice issue — §14 UStG; immutable after insert.';
