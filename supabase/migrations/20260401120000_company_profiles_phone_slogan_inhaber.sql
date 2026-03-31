-- Contact line + branding for invoice PDF (Absenderzeile, Logo, Slogan)
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS slogan TEXT,
  ADD COLUMN IF NOT EXISTS inhaber TEXT;

COMMENT ON COLUMN public.company_profiles.phone IS
  'Telefonnummer für Absenderzeile und Korrespondenz auf der Rechnung.';

COMMENT ON COLUMN public.company_profiles.slogan IS
  'Kurzer Slogan/Werbesatz unter dem Logo (PDF links oben).';

COMMENT ON COLUMN public.company_profiles.inhaber IS
  'Inhaber oder gesetzliche Vertretung (z. B. bei Einzelunternehmen, e. K.).';
