-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 20260408120001_pdf_vorlagen
--
-- Introduces the PDF-Vorlagen system: named, reusable column profile templates
-- that control which columns appear in invoice PDFs (main page + appendix).
--
-- New objects:
--   pdf_vorlagen          — named column profile templates per company
--   payers.pdf_vorlage_id — assigns a default Vorlage to a Kostenträger
--   invoices.pdf_column_override — per-invoice column override (dispatcher)
--
-- Resolution priority chain (app-layer, see resolve-pdf-column-profile.ts):
--   1. invoices.pdf_column_override  (dispatcher override for one invoice)
--   2. payers.pdf_vorlage_id         (Kostenträger default Vorlage)
--   3. pdf_vorlagen WHERE is_default (company-wide fallback Vorlage)
--   4. SYSTEM_DEFAULT_* constants    (hardcoded app fallback — no DB row needed)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── pdf_vorlagen ────────────────────────────────────────────────────────────
-- Named, reusable column profile templates. Each company manages its own set.
-- A Vorlage defines which columns appear on the main invoice page and the
-- appendix page; main_layout controls grouped vs flat main table (Phase 6e).
CREATE TABLE public.pdf_vorlagen (
  -- Primary key — UUID, referenced by payers.pdf_vorlage_id
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scopes this Vorlage to one company. Cascade-deletes all Vorlagen when
  -- the company profile is deleted (GDPR / account deletion compliance).
  company_id       uuid NOT NULL
    REFERENCES public.company_profiles(company_id) ON DELETE CASCADE,
  -- Human-readable name shown in the Vorlage picker UI.
  -- Examples: "Standard-Monatsabrechnung", "Einzelfahrt Kompakt"
  name             text NOT NULL,
  -- Optional longer description shown as a tooltip in the picker.
  description      text,
  -- Ordered array of PdfColumnKey strings for the main invoice page table.
  -- Validated at the app layer via VALID_COLUMN_KEYS (pdf-column-catalog.ts).
  -- Default matches SYSTEM_DEFAULT_MAIN_COLUMNS in the TypeScript catalog.
  main_columns     jsonb NOT NULL DEFAULT '["position","trip_date","client_name","billing_variant","net_price","tax_rate","gross_price"]',
  -- Ordered array of PdfColumnKey strings for the appendix page table.
  -- Validated at the app layer via VALID_COLUMN_KEYS.
  -- When length > APPENDIX_LANDSCAPE_THRESHOLD (7), the appendix page
  -- automatically switches to landscape orientation.
  appendix_columns jsonb NOT NULL DEFAULT '["position","trip_date","client_name","pickup_address","dropoff_address","distance_km","net_price"]',
  -- Controls whether the main page table groups trips by Leistung/route
  -- ('grouped', default — compact summary rows) or renders one row per trip
  -- ('flat' — full transparency, may span multiple pages for large invoices).
  -- The appendix always renders flat regardless of this setting.
  main_layout      text NOT NULL DEFAULT 'grouped'
    CHECK (main_layout IN ('grouped', 'flat')),
  -- When true, this Vorlage is used as the company-wide fallback when a
  -- Kostenträger has no pdf_vorlage_id assigned.
  -- Enforced: at most one is_default = true per company_id (see partial index).
  is_default       boolean NOT NULL DEFAULT false,
  -- Audit timestamps — updated_at maintained by the application on UPDATE.
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Enforces the single-default invariant per company.
-- Partial unique index on (company_id) WHERE is_default = true rejects a second
-- is_default=true row for the same company. setDefaultVorlage() clears others first.
CREATE UNIQUE INDEX pdf_vorlagen_company_default_idx
  ON public.pdf_vorlagen(company_id)
  WHERE is_default = true;

COMMENT ON TABLE public.pdf_vorlagen IS
  'Named PDF column profile templates per company; used to resolve invoice table columns.';

COMMENT ON INDEX public.pdf_vorlagen_company_default_idx IS
  'Partial unique: at most one is_default Vorlage per company_id; supports company-wide fallback resolution.';

-- ─── payers.pdf_vorlage_id ───────────────────────────────────────────────────
-- Each Kostenträger can be assigned one Vorlage as its invoice column default.
-- Null = no assignment; app falls through to company default, then system fallback.
-- ON DELETE SET NULL: deleting a Vorlage clears the FK without deleting the payer.
ALTER TABLE public.payers
  ADD COLUMN pdf_vorlage_id uuid
    REFERENCES public.pdf_vorlagen(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payers.pdf_vorlage_id IS
  'FK to pdf_vorlagen. When set, invoices for this Kostenträger use this Vorlage '
  'as the default column profile (overrideable per-invoice via invoices.pdf_column_override). '
  'Null = fall through to company default Vorlage, then SYSTEM_DEFAULT_* constants.';

-- ─── invoices.pdf_column_override ────────────────────────────────────────────
-- Per-invoice column override set by the dispatcher in builder PDF-Vorlage section.
-- Null = use the Kostenträger-assigned Vorlage (or company default / system fallback).
-- Shape validated by pdfColumnOverrideSchema in pdf-vorlage.types.ts.
-- §14 UStG: immutable after invoice creation.
ALTER TABLE public.invoices
  ADD COLUMN pdf_column_override jsonb;

COMMENT ON COLUMN public.invoices.pdf_column_override IS
  'Per-invoice PDF column override. Null = resolve from Kostenträger Vorlage → '
  'company default → SYSTEM_DEFAULT_*. Non-null = use these columns for this invoice only. '
  '§14 UStG: immutable after invoice creation.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Each company may only access its own Vorlagen rows. Split policies per command
-- so INSERT gets WITH CHECK (USING alone does not apply to INSERT in PostgreSQL).
ALTER TABLE public.pdf_vorlagen ENABLE ROW LEVEL SECURITY;

-- SELECT: rows visible only when company_id matches the authenticated user's company.
CREATE POLICY "pdf_vorlagen: select own company"
  ON public.pdf_vorlagen FOR SELECT
  USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

-- INSERT: WITH CHECK prevents inserting a row for another company.
CREATE POLICY "pdf_vorlagen: insert own company"
  ON public.pdf_vorlagen FOR INSERT
  WITH CHECK (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

-- UPDATE: USING limits which rows can be updated; WITH CHECK ensures company_id
-- is not changed to another tenant after update.
CREATE POLICY "pdf_vorlagen: update own company"
  ON public.pdf_vorlagen FOR UPDATE
  USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  )
  WITH CHECK (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

-- DELETE: only own-company rows. App layer deletePdfVorlage also blocks delete
-- when any payer still references this Vorlage.
CREATE POLICY "pdf_vorlagen: delete own company"
  ON public.pdf_vorlagen FOR DELETE
  USING (
    company_id = (SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_vorlagen TO authenticated, service_role;
