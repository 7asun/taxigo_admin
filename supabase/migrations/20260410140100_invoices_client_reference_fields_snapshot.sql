-- §14 UStG: copy of clients.reference_fields frozen at invoice creation for immutable PDF output.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_reference_fields_snapshot jsonb;

COMMENT ON COLUMN public.invoices.client_reference_fields_snapshot IS
  'Frozen {label,value}[] from clients.reference_fields at invoice insert time (§14 UStG). '
  'NULL when client_id is null or client has no reference fields. Never UPDATE after issue.';
