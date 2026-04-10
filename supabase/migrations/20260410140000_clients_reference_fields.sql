-- Ordered Bezugszeichen / reference lines for PDF (label + value per column).
-- Shape: JSON array of { "label": string, "value": string }, order preserved.
-- Application convention: NULL when no fields (after stripping empty labels); do not store [] for "empty".

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS reference_fields jsonb;

COMMENT ON COLUMN public.clients.reference_fields IS
  'Ordered {label,value} pairs for invoice PDF reference bar (Bezugszeichen). '
  'NULL when unused; app strips rows with empty labels before save.';
