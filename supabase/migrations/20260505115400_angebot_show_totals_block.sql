-- Adds opt-in totals block flag to angebote.
-- Default false preserves existing behaviour for all current quotes.
-- The totals block is only rendered in the PDF when this is true AND
-- the column schema contains a net_amount role column.
ALTER TABLE public.angebote
  ADD COLUMN show_totals_block boolean NOT NULL DEFAULT false;

