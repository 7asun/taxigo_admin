-- Migration: Change line_date from DATE to TIMESTAMPTZ to preserve trip time
-- Created: 2026-04-02

-- Change line_date from DATE to TIMESTAMPTZ to store full scheduled_at timestamp
ALTER TABLE public.invoice_line_items
  ALTER COLUMN line_date TYPE TIMESTAMPTZ;

-- Update the column comment to reflect the change
COMMENT ON COLUMN public.invoice_line_items.line_date IS
$$Date and time of the transport service (from trips.scheduled_at).
Printed as "Datum der Leistung" on the invoice per §14 UStG.
NULL for manual items where no date is relevant.$$;
