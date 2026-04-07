-- ============================================================
-- Migration: add_address_fields_to_payers
--
-- Adds postal and contact fields to the `payers` (Kostenträger)
-- table. These fields are legally required on German invoices
-- (§14 UStG — Pflichtangaben Leistungsempfänger).
--
-- All columns are nullable so existing payer records are
-- unaffected. Fill them in via the Kostenträger settings UI
-- before generating invoices for a given payer.
--
-- Run once in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS street          TEXT,
  ADD COLUMN IF NOT EXISTS street_number   TEXT,
  ADD COLUMN IF NOT EXISTS zip_code        TEXT,
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS contact_person  TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT;


-- ════════════════════════════════════════════════════════════
-- Column comments — TABLE: payers
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE public.payers IS
$$Represents a Kostenträger (cost bearer / payer) — typically a
social services office, health insurance, or similar institution
that finances patient transport. One company can have many payers.

Each payer can have multiple billing_types (Abrechnungsfamilien)
and each billing_type can have multiple billing_variants.$$;

-- Existing columns (documented here for completeness)

COMMENT ON COLUMN public.payers.id IS
$$Primary key (UUID). Auto-generated on insert.$$;

COMMENT ON COLUMN public.payers.company_id IS
$$FK → companies.id. The Taxi company that manages this payer.
Used to scope all admin queries (multi-tenant isolation).$$;

COMMENT ON COLUMN public.payers.name IS
$$Full name of the payer as it appears on invoices.
Example: "AOK Niedersachsen – Die Gesundheitskasse".$$;

COMMENT ON COLUMN public.payers.number IS
$$Optional internal reference number for this payer.
Can be used for contract numbers or accounting codes.$$;

COMMENT ON COLUMN public.payers.created_at IS
$$Timestamp (UTC) when this payer record was created.
Auto-set by the database on insert.$$;

-- New address columns

COMMENT ON COLUMN public.payers.street IS
$$Street name of the payer's legal address.
Required for invoice recipient block (§14 UStG).
Example: "Musterstraße".$$;

COMMENT ON COLUMN public.payers.street_number IS
$$House / building number of the payer's legal address.
Required for invoice recipient block (§14 UStG).
Example: "12a".$$;

COMMENT ON COLUMN public.payers.zip_code IS
$$Postal code (Postleitzahl) of the payer's legal address.
Required for invoice recipient block (§14 UStG).
Example: "26122".$$;

COMMENT ON COLUMN public.payers.city IS
$$City of the payer's legal address.
Required for invoice recipient block (§14 UStG).
Example: "Oldenburg".$$;

COMMENT ON COLUMN public.payers.contact_person IS
$$Optional: name of the primary contact person at this payer.
Shown on the invoice as "z. Hd." (zu Händen von).
Example: "Frau Müller".$$;

COMMENT ON COLUMN public.payers.email IS
$$Optional: e-mail address of the payer.
Intended for future invoice PDF delivery via e-mail.
Not yet used in Phase 1.$$;

COMMENT ON COLUMN public.payers.phone IS
$$Optional: telephone number of the payer.
For internal reference and correspondence.$$;
