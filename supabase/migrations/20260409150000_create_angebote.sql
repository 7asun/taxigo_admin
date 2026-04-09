-- Angebote (Offers) module — tables, RLS, offer number RPC.
--
-- Mirrors the invoices/invoice_line_items pattern.
-- Uses existing helpers: public.current_user_is_admin(), public.current_user_company_id()
-- from 20260318130000_rename_users_to_accounts.sql.
--
-- Offer number format: AG-YYYY-MM-NNNN (per-month, resets each month).
-- Generation uses RPC angebot_numbers_max_for_prefix (SECURITY DEFINER) below.

-- ─── Enum ─────────────────────────────────────────────────────────────────────

CREATE TYPE public.angebot_status AS ENUM ('draft', 'sent', 'accepted', 'declined');

-- ─── angebote ─────────────────────────────────────────────────────────────────

CREATE TABLE public.angebote (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- References companies(id) — the same multi-tenant FK used by invoices, trips, payers, etc.
  -- accounts.company_id = companies.id, so this matches what the API receives.
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  angebot_number          TEXT NOT NULL UNIQUE,
  status                  public.angebot_status NOT NULL DEFAULT 'draft',

  -- Recipient (free text — no FK to payers; offers go to prospects too)
  recipient_company       TEXT,
  recipient_name          TEXT,          -- Ansprechperson full name
  recipient_anrede        TEXT,          -- 'Herr' | 'Frau' | null
  recipient_street        TEXT,
  recipient_street_number TEXT,
  recipient_zip           TEXT,
  recipient_city          TEXT,
  recipient_email         TEXT,
  recipient_phone         TEXT,
  customer_number         TEXT,          -- optional, shown in PDF meta grid

  -- Offer meta
  subject                 TEXT,          -- Subject line shown in PDF body
  valid_until             DATE,
  offer_date              DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Text content (shared invoice_text_blocks table for intro/outro)
  intro_text              TEXT,
  outro_text              TEXT,

  -- PDF column profile snapshot (AngebotColumnProfile JSONB)
  pdf_column_override     JSONB,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── angebot_line_items ───────────────────────────────────────────────────────

CREATE TABLE public.angebot_line_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  angebot_id            UUID NOT NULL REFERENCES public.angebote(id) ON DELETE CASCADE,
  position              INTEGER NOT NULL,          -- display order (1-based)
  leistung              TEXT NOT NULL DEFAULT '',  -- service description
  anfahrtkosten         NUMERIC(10,2),             -- approach cost (€)
  price_first_5km       NUMERIC(10,2),             -- flat price for first 5 km (€)
  price_per_km_after_5  NUMERIC(10,2),             -- price per km after 5 km (€/km)
  notes                 TEXT,                      -- optional row notes
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.angebote ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.angebot_line_items ENABLE ROW LEVEL SECURITY;

-- angebote: admin-only, company-scoped
CREATE POLICY "angebote_select_company_admin" ON public.angebote
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "angebote_insert_company_admin" ON public.angebote
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "angebote_update_company_admin" ON public.angebote
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "angebote_delete_company_admin" ON public.angebote
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- angebot_line_items: scoped via parent angebot
CREATE POLICY "angebot_line_items_select_company_admin" ON public.angebot_line_items
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.angebote a
      WHERE a.id = angebot_line_items.angebot_id
        AND a.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "angebot_line_items_insert_company_admin" ON public.angebot_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.angebote a
      WHERE a.id = angebot_line_items.angebot_id
        AND a.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "angebot_line_items_update_company_admin" ON public.angebot_line_items
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.angebote a
      WHERE a.id = angebot_line_items.angebot_id
        AND a.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "angebot_line_items_delete_company_admin" ON public.angebot_line_items
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.angebote a
      WHERE a.id = angebot_line_items.angebot_id
        AND a.company_id = public.current_user_company_id()
    )
  );

-- ─── Offer number RPC ─────────────────────────────────────────────────────────
-- Global MAX lookup for angebot_number (bypasses RLS).
-- Offer numbers are unique across all companies; per-company SELECT policies would
-- otherwise return a wrong MAX and cause UNIQUE violations.
-- Only admins may execute — mirrors invoice_numbers_max_for_prefix exactly.

CREATE OR REPLACE FUNCTION public.angebot_numbers_max_for_prefix(p_prefix text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT a.angebot_number
    FROM public.angebote a
    WHERE a.angebot_number LIKE p_prefix || '%'
    ORDER BY a.angebot_number DESC
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.angebot_numbers_max_for_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.angebot_numbers_max_for_prefix(text) TO authenticated;

COMMENT ON FUNCTION public.angebot_numbers_max_for_prefix(text) IS
$$Returns the lexicographically greatest angebot_number matching p_prefix||'%' (global, all tenants). Used by the app to allocate AG-YYYY-MM-NNNN. SECURITY DEFINER; restricted to current_user_is_admin().$$;
