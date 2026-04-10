-- =============================================================================
-- Rechnungsempfänger: Split name into structured fields + add phone
-- =============================================================================

-- Add new columns for structured name and contact info
ALTER TABLE public.rechnungsempfaenger
  ADD COLUMN IF NOT EXISTS anrede TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS abteilung TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Migrate existing data: split name into first_name and last_name
-- Assumes "First Last" format; falls back to putting everything in last_name
UPDATE public.rechnungsempfaenger
SET 
  first_name = CASE 
    WHEN name IS NULL THEN NULL
    WHEN position(' ' in name) > 0 THEN split_part(name, ' ', 1)
    ELSE NULL
  END,
  last_name = CASE 
    WHEN name IS NULL THEN NULL
    WHEN position(' ' in name) > 0 THEN substr(name, position(' ' in name) + 1)
    ELSE name
  END
WHERE first_name IS NULL AND last_name IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.rechnungsempfaenger.anrede IS
  'Anrede/Titel (z.B. Herr, Frau, Dr., etc.)';

COMMENT ON COLUMN public.rechnungsempfaenger.first_name IS
  'Vorname des Rechnungsempfängers';

COMMENT ON COLUMN public.rechnungsempfaenger.last_name IS
  'Nachname des Rechnungsempfängers';

COMMENT ON COLUMN public.rechnungsempfaenger.company_name IS
  'Optionaler Firmenname für die Rechnungsadresse';

COMMENT ON COLUMN public.rechnungsempfaenger.abteilung IS
  'Abteilung oder Referat innerhalb der Organisation';

COMMENT ON COLUMN public.rechnungsempfaenger.phone IS
  'Telefonnummer des Rechnungsempfängers';

-- Keep the original name column for backward compatibility
COMMENT ON COLUMN public.rechnungsempfaenger.name IS
  'DEPRECATED: Use anrede, first_name, last_name, company_name instead. Kept for backward compatibility.';
