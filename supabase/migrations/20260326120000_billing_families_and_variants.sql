-- =============================================================================
-- Billing variants layered on existing public.billing_types (Abrechnungsfamilie).
-- - billing_types: kept as-is; COMMENTs document semantics (no new table name).
-- - billing_variants: Unterart rows; FK billing_type_id → billing_types(id).
-- - trips.billing_variant_id: leaf FK; trips.billing_type_id dropped after backfill.
--
-- If you already applied an older version of this migration that created
-- billing_families and dropped billing_types, do not re-run this file — you need
-- a one-off repair migration instead.
-- RLS: mirror any billing_types / billing_variants policies from your Supabase project.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Document billing_types (Abrechnungsfamilie)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.billing_types IS
  'Abrechnungsfamilie je Kostenträger: Anzeigename, UI-Farbe und behavior_profile (Rückfahrt, Adress-Locks, Stations-Pflicht, Defaults). CSV-Spalte abrechnungsart matcht billing_types.name. Konkrete Unterarten (CSV-Code) liegen in billing_variants.';

COMMENT ON COLUMN public.billing_types.id IS
  'Primärschlüssel; Elternzeile für billing_variants.billing_type_id und indirekt für trips.billing_variant_id.';

COMMENT ON COLUMN public.billing_types.payer_id IS
  'Kostenträger (Fremdschlüssel payers). ON DELETE CASCADE entfernt alle Abrechnungsfamilien und damit Varianten dieses Payers.';

COMMENT ON COLUMN public.billing_types.name IS
  'Anzeige-„Abrechnungsart“ / Familienbezeichnung; muss je payer_id eindeutig sein; Bulk-CSV matcht case-insensitiv (trim).';

COMMENT ON COLUMN public.billing_types.color IS
  'Hex-Farbe für Badges, Kanban, Druck — nicht für Buchhaltung.';

COMMENT ON COLUMN public.billing_types.behavior_profile IS
  'JSON (BillingTypeBehavior): returnPolicy, lockPickup/Dropoff, Stations-Pflicht, strukturierte Default-Adressen — gilt für alle Varianten unter dieser Familie.';

COMMENT ON COLUMN public.billing_types.created_at IS
  'Anlagezeitpunkt; hilft bei sortierter Migration und Admin-Übersicht.';

-- -----------------------------------------------------------------------------
-- 2) billing_variants (Unterart / CSV-identifiable row)
-- -----------------------------------------------------------------------------
CREATE TABLE public.billing_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_type_id uuid NOT NULL REFERENCES public.billing_types (id) ON DELETE CASCADE,
  name text NOT NULL,
  code varchar(6) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_variants_type_name_unique UNIQUE (billing_type_id, name),
  CONSTRAINT billing_variants_type_code_unique UNIQUE (billing_type_id, code),
  CONSTRAINT billing_variants_code_format CHECK (code ~ '^[A-Z0-9]{2,6}$')
);

COMMENT ON TABLE public.billing_variants IS
  'Unterart unter einer billing_types-Zeile; stabiler code für CSV (abrechnungsvariante/unterart), Exporte und spätere Rechnungslogik.';

COMMENT ON COLUMN public.billing_variants.id IS
  'Primärschlüssel; trips.billing_variant_id verweist hierauf (ON DELETE SET NULL auf Trip).';

COMMENT ON COLUMN public.billing_variants.billing_type_id IS
  'Zugehörige Abrechnungsfamilie (public.billing_types). CASCADE: Löschen der Familie löscht alle Varianten.';

COMMENT ON COLUMN public.billing_variants.name IS
  'Anzeigename der Unterart (z. B. Standard, KTS); CSV kann nach name gematcht werden wenn code fehlt (innerhalb der Familie).';

COMMENT ON COLUMN public.billing_variants.code IS
  'Kurzcode 2–6 Zeichen [A-Z0-9], eindeutig pro billing_type_id; bevorzugtes CSV-Match vor name.';

COMMENT ON COLUMN public.billing_variants.sort_order IS
  'Reihenfolge in Admin-UI und Trip-Formular-Dropdowns.';

COMMENT ON COLUMN public.billing_variants.created_at IS
  'Anlagezeitpunkt.';

CREATE INDEX billing_variants_billing_type_id_idx ON public.billing_variants (billing_type_id);

-- -----------------------------------------------------------------------------
-- 3) trips: billing_variant_id (backfilled before dropping billing_type_id)
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips
  ADD COLUMN billing_variant_id uuid REFERENCES public.billing_variants (id) ON DELETE SET NULL;

CREATE INDEX trips_billing_variant_id_idx ON public.trips (billing_variant_id);

COMMENT ON COLUMN public.trips.billing_variant_id IS
  'Gewählte Abrechnungs-Unterart; über billing_variants → billing_types für Farbe und behavior_profile.';

-- -----------------------------------------------------------------------------
-- 4) Backfill: eine „Standard“-Variante pro billing_types + Trips umhängen
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._billing_migrate_gen_code(p_name text, p_old_id uuid)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  h text;
BEGIN
  s := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(s) >= 6 THEN
    RETURN left(s, 6);
  END IF;
  IF length(s) >= 2 THEN
    RETURN s;
  END IF;
  h := upper(substring(md5(p_old_id::text), 1, 5));
  RETURN 'M' || h;
END;
$$;

DO $$
DECLARE
  r record;
  v_variant_id uuid;
  v_code text;
  v_attempt int;
  v_suffix text;
BEGIN
  FOR r IN
    SELECT id, name
    FROM public.billing_types
    ORDER BY created_at, id
  LOOP
    v_code := public._billing_migrate_gen_code(r.name, r.id);
    v_attempt := 0;

    WHILE EXISTS (
      SELECT 1 FROM public.billing_variants bv WHERE bv.billing_type_id = r.id AND bv.code = v_code
    ) LOOP
      v_attempt := v_attempt + 1;
      v_suffix := upper(substring(md5(r.id::text || v_attempt::text), 1, 2));
      v_code := 'M' || v_suffix || upper(substring(md5(r.name || v_attempt::text), 1, 3));
      v_code := left(v_code, 6);
      IF length(v_code) < 2 THEN
        v_code := 'M' || upper(substring(md5(random()::text), 1, 5));
        v_code := left(v_code, 6);
      END IF;
    END LOOP;

    INSERT INTO public.billing_variants (billing_type_id, name, code, sort_order)
    VALUES (r.id, 'Standard', v_code, 0)
    RETURNING id INTO v_variant_id;

    UPDATE public.trips
    SET billing_variant_id = v_variant_id
    WHERE billing_type_id = r.id;
  END LOOP;
END;
$$;

DROP FUNCTION public._billing_migrate_gen_code(text, uuid);

-- -----------------------------------------------------------------------------
-- 5) Legacy direkte Trip-Referenz auf Abrechnungsfamilie entfernen
-- -----------------------------------------------------------------------------
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_billing_type_id_fkey;

ALTER TABLE public.trips DROP COLUMN IF EXISTS billing_type_id;

-- -----------------------------------------------------------------------------
-- 6) Grants
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_variants TO authenticated, service_role;
