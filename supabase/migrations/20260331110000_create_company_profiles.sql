-- ============================================================
-- Migration: create_company_profiles
--
-- Creates the company_profiles table. This is the legal and
-- financial identity of the Taxi company — the "Leistungserbringer"
-- block that appears on every invoice.
--
-- WHY a separate table (not extending companies)?
--   The existing `companies` table is a lightweight identity
--   record (id, name, code) used as a FK across the entire
--   system (trips, payers, drivers, etc.). Adding invoice-specific
--   fields there would bloat every JOIN and mix unrelated concerns.
--   company_profiles is a clean 1:1 extension: one profile per
--   company, loaded only when the settings page or invoice PDF
--   needs it. New fields can be added here without touching the
--   core system FK.
--
-- Relationship: companies (1) ──── (1) company_profiles
-- Used by:      invoice PDF header, invoice builder guard check
--
-- Run once in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_profiles (

  -- ── Identity ──────────────────────────────────────────────
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to the core companies record (the dispatch system identity).
  -- UNIQUE enforces the 1:1 relationship — one profile per company.
  -- Must be UUID (not TEXT) to match the actual type of companies.id.
  company_id            UUID          NOT NULL
                          REFERENCES public.companies(id) ON DELETE CASCADE,
  UNIQUE (company_id),

  -- ── Legal Name ────────────────────────────────────────────
  -- Full legal company name as registered with the Finanzamt.
  -- This is the name that is printed on invoices under §14 UStG.
  legal_name            TEXT          NOT NULL,

  -- ── Postal Address ────────────────────────────────────────
  -- All four address fields are required for a legally valid
  -- German invoice (§14 UStG — vollständige Anschrift).
  street                TEXT          NOT NULL,
  street_number         TEXT          NOT NULL,
  zip_code              TEXT          NOT NULL,
  city                  TEXT          NOT NULL,

  -- ── Tax Identifiers ───────────────────────────────────────
  -- Steuernummer: issued by the local Finanzamt.
  -- Format varies by state (e.g. "123/456/78901" in Niedersachsen).
  -- Required on invoices when no USt-IdNr is present.
  tax_id                TEXT,

  -- USt-Identifikationsnummer (USt-IdNr): EU VAT registration number.
  -- Format: DE followed by 9 digits (e.g. "DE123456789").
  -- Required for cross-border B2B; often included for domestic B2B too.
  -- At least one of tax_id or vat_id should be present for valid invoices.
  vat_id                TEXT,

  -- ── Bank Details ──────────────────────────────────────────
  -- Printed in the invoice footer so clients can pay by Überweisung.
  bank_name             TEXT,         -- Name of the bank (e.g. "Sparkasse Oldenburg")
  bank_iban             TEXT,         -- IBAN (e.g. "DE89 3704 0044 0532 0130 00")
  bank_bic              TEXT,         -- BIC / SWIFT code (e.g. "COBADEFFXXX")

  -- ── Branding ──────────────────────────────────────────────
  -- Supabase Storage path to the company logo.
  -- Rendered in the top-left of every invoice PDF.
  -- Upload handled via company settings page → Storage bucket: company-assets.
  logo_url              TEXT,

  -- ── Invoice Defaults ──────────────────────────────────────
  -- Number of days from the invoice date until payment is due (Zahlungsziel).
  -- This value is copied into each new invoice but can be overridden per invoice.
  -- Default: 14 days (standard in German B2B).
  default_payment_days  INTEGER       NOT NULL DEFAULT 14,

  -- ── Timestamps ────────────────────────────────────────────
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Set to now() whenever the profile is saved in the company settings page.
  updated_at            TIMESTAMPTZ
);

-- Allow fast lookup by company (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_company_profiles_company_id
  ON public.company_profiles (company_id);


-- ════════════════════════════════════════════════════════════
-- Column comments — TABLE: company_profiles
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE public.company_profiles IS
$$Legal and financial identity of the Taxi company (Leistungserbringer).
One record per company. Used as the issuer block on all invoices.

Intentionally separate from the companies table (which is a
lightweight identity FK used system-wide). Only loaded when the
invoice PDF or company settings page is rendered.$$;

COMMENT ON COLUMN public.company_profiles.id IS
$$Primary key (UUID). Auto-generated on insert.$$;

COMMENT ON COLUMN public.company_profiles.company_id IS
$$FK → companies.id (UUID). Ties this profile to one Taxi company.
UNIQUE constraint enforces the 1:1 relationship.
CASCADE DELETE: removing a company removes its profile too.
Type is UUID (not TEXT) — must match companies.id exactly.$$;

COMMENT ON COLUMN public.company_profiles.legal_name IS
$$Full legal company name as registered with the Finanzamt.
Printed as the top-line of the invoice issuer block.
Example: "Taxigo GmbH" or "Mustermann Taxibetrieb e.K.".$$;

COMMENT ON COLUMN public.company_profiles.street IS
$$Street name of the company's registered business address.
Required on invoices per §14 Abs. 4 Nr. 1 UStG.$$;

COMMENT ON COLUMN public.company_profiles.street_number IS
$$House / building number of the company's registered address.$$;

COMMENT ON COLUMN public.company_profiles.zip_code IS
$$Postal code (Postleitzahl) of the company's registered address.$$;

COMMENT ON COLUMN public.company_profiles.city IS
$$City of the company's registered address.$$;

COMMENT ON COLUMN public.company_profiles.tax_id IS
$$Steuernummer issued by the local Finanzamt.
Format varies by state: e.g. "123/456/78901" (Niedersachsen).
Printed on invoices when no USt-IdNr is present (§14 Abs. 4 Nr. 2 UStG).
Nullable — but at least one of tax_id or vat_id must be set.$$;

COMMENT ON COLUMN public.company_profiles.vat_id IS
$$USt-Identifikationsnummer (EU VAT ID).
Format: "DE" + 9 digits (e.g. "DE123456789").
Typically required for B2B invoices. Takes precedence over tax_id
when both are present.
Nullable — but at least one of tax_id or vat_id must be set.$$;

COMMENT ON COLUMN public.company_profiles.bank_name IS
$$Name of the company's bank, shown in the invoice footer.
Example: "Sparkasse Oldenburg".$$;

COMMENT ON COLUMN public.company_profiles.bank_iban IS
$$IBAN for Überweisung payments, shown in the invoice footer.
Example: "DE89 3704 0044 0532 0130 00".$$;

COMMENT ON COLUMN public.company_profiles.bank_bic IS
$$BIC / SWIFT code of the company's bank, shown in the invoice footer.
Example: "COBADEFFXXX". Required for international transfers.$$;

COMMENT ON COLUMN public.company_profiles.logo_url IS
$$Supabase Storage URL of the company logo image.
Rendered in the top-left corner of every invoice PDF.
Upload via company settings page. NULL = no logo on invoices.$$;

COMMENT ON COLUMN public.company_profiles.default_payment_days IS
$$Default number of days from invoice date until payment is due (Zahlungsziel).
Copied into invoices.payment_due_days on invoice creation but editable per invoice.
Default: 14 (standard German B2B net-14).$$;

COMMENT ON COLUMN public.company_profiles.created_at IS
$$Timestamp (UTC) when this profile was first created.$$;

COMMENT ON COLUMN public.company_profiles.updated_at IS
$$Timestamp (UTC) of the last save from the company settings page.
Updated by the API layer on every UPSERT (set to now()).$$;
