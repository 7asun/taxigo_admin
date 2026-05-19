-- Quote-level optional default MwSt-Satz (percent 0–100) for Summenblock / computeRow fallback.
-- WHY: nullable — never invent a default VAT percentage in SQL (no magic rates).

ALTER TABLE public.angebote
  ADD COLUMN IF NOT EXISTS default_tax_rate numeric;

COMMENT ON COLUMN public.angebote.default_tax_rate IS
  'Optional quote-level VAT percent (0–100). Used when line rows have no tax_rate column value; per-row values always win.';
