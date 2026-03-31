-- Kontakt: E-Mail und Webseite für Rechnungsfußzeile / Impressum
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;

COMMENT ON COLUMN public.company_profiles.email IS
  'Öffentliche Kontakt-E-Mail (Rechnung, Fußzeile).';

COMMENT ON COLUMN public.company_profiles.website IS
  'Webseite / URL (Rechnung, Fußzeile).';
