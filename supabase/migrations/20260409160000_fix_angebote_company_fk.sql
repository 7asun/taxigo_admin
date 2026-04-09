-- Corrective migration: angebote.company_id FK was pointing to company_profiles(id)
-- on instances where the original migration ran before the fix.
-- Re-targets to public.companies(id) — identical to invoices.company_id.
-- Safe to run on all environments: uses DROP CONSTRAINT IF EXISTS.
--
-- Additional context:
-- DBs created from an earlier revision of 20260409150000_create_angebote.sql may still
-- have angebote_company_id_fkey → company_profiles(id); this migration corrects that.
-- Fresh installs: 20260409150000_create_angebote.sql already references companies(id).
--
-- Note: A filename like 20260408195000_* would sort before 20260409150000_create_angebote.sql
-- and would fail on fresh installs (angebote does not exist yet). This file is timestamped
-- after the create migration so `supabase db push` ordering stays valid.

ALTER TABLE public.angebote
  DROP CONSTRAINT IF EXISTS angebote_company_id_fkey;

ALTER TABLE public.angebote
  ADD CONSTRAINT angebote_company_id_fkey
  FOREIGN KEY (company_id)
  REFERENCES public.companies(id)
  ON DELETE CASCADE;
