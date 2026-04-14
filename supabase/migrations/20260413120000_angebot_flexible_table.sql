-- Phase 2a: flexible Angebot line-item table — angebot_vorlagen, data jsonb, snapshots.
-- Well-known column id literals in backfill/seed must match ANGEBOT_LEGACY_COLUMN_IDS in
-- src/features/angebote/lib/angebot-legacy-column-ids.ts

-- =============================================================================
-- angebot_vorlagen: company-scoped offer table templates (column schema only)
-- =============================================================================
CREATE TABLE public.angebot_vorlagen (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           REFERENCES public.companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  is_default             boolean NOT NULL DEFAULT false,
  -- JSON array of column definition objects. Documented shape (SQL comment):
  -- [
  --   {
  --     "id": "col_uuid",
  --     "header": "Anfahrtkosten",
  --     "type": "currency" | "currency_per_km" | "text" | "integer" | "percent",
  --     "weight": 2,
  --     "minWidth": 60,
  --     "required": false,
  --     "formula": null
  --   }
  -- ]
  -- Phase 2a: "formula" is reserved for future calculated columns — omit or null.
  columns                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angebot_vorlagen_columns_is_array
    CHECK (jsonb_typeof(columns) = 'array')
);

CREATE UNIQUE INDEX angebot_vorlagen_company_default_idx
  ON public.angebot_vorlagen(company_id)
  WHERE is_default = true;

COMMENT ON TABLE public.angebot_vorlagen IS
  'Reusable Angebot (offer) table templates: ordered column schema for builder + PDF.';

COMMENT ON COLUMN public.angebot_vorlagen.columns IS
  'JSON array of { id, header, type, weight, minWidth, required?, formula? }. See migration header.';

-- =============================================================================
-- angebote: link + frozen schema snapshot
-- =============================================================================
ALTER TABLE public.angebote
  ADD COLUMN angebot_vorlage_id uuid
    REFERENCES public.angebot_vorlagen(id) ON DELETE SET NULL;

ALTER TABLE public.angebote
  ADD COLUMN table_schema_snapshot jsonb;

COMMENT ON COLUMN public.angebote.table_schema_snapshot IS
  'Frozen copy of angebot_vorlagen.columns at offer creation time (Phase 2a: immutable after insert; PDF uses this, not live template).';

COMMENT ON COLUMN public.angebote.angebot_vorlage_id IS
  'Template chosen at offer creation (audit FK; immutable after insert in Phase 2a). PDF resolves columns from table_schema_snapshot.';

-- =============================================================================
-- angebot_line_items: flexible cell storage
-- =============================================================================
ALTER TABLE public.angebot_line_items
  ADD COLUMN data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.angebot_line_items.data IS
  'Cell values keyed by column id from angebote.table_schema_snapshot.';

COMMENT ON COLUMN public.angebot_line_items.leistung IS
  'DEPRECATED: replaced by data jsonb keyed by col_leistung (see ANGEBOT_LEGACY_COLUMN_IDS). drop in next major migration after all reads use data + snapshot';

COMMENT ON COLUMN public.angebot_line_items.anfahrtkosten IS
  'DEPRECATED: replaced by data jsonb keyed by col_anfahrtkosten. drop in next major migration after all reads use data + snapshot';

COMMENT ON COLUMN public.angebot_line_items.price_first_5km IS
  'DEPRECATED: replaced by data jsonb keyed by col_price_first_5km. drop in next major migration after all reads use data + snapshot';

COMMENT ON COLUMN public.angebot_line_items.price_per_km_after_5 IS
  'DEPRECATED: replaced by data jsonb keyed by col_price_per_km_after_5. drop in next major migration after all reads use data + snapshot';

COMMENT ON COLUMN public.angebot_line_items.notes IS
  'DEPRECATED: replaced by data jsonb keyed by col_notes. drop in next major migration after all reads use data + snapshot';

-- =============================================================================
-- Backfill: copy typed scalars into data jsonb
-- =============================================================================
UPDATE public.angebot_line_items li
SET data = COALESCE(li.data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       -- col_leistung — must match ANGEBOT_LEGACY_COLUMN_IDS in src/features/angebote/lib/angebot-legacy-column-ids.ts
       'col_leistung', to_jsonb(li.leistung),
       -- col_anfahrtkosten — must match ANGEBOT_LEGACY_COLUMN_IDS in src/features/angebote/lib/angebot-legacy-column-ids.ts
       'col_anfahrtkosten', to_jsonb(li.anfahrtkosten),
       -- col_price_first_5km — must match ANGEBOT_LEGACY_COLUMN_IDS in src/features/angebote/lib/angebot-legacy-column-ids.ts
       'col_price_first_5km', to_jsonb(li.price_first_5km),
       -- col_price_per_km_after_5 — must match ANGEBOT_LEGACY_COLUMN_IDS in src/features/angebote/lib/angebot-legacy-column-ids.ts
       'col_price_per_km_after_5', to_jsonb(li.price_per_km_after_5),
       -- col_notes — must match ANGEBOT_LEGACY_COLUMN_IDS in src/features/angebote/lib/angebot-legacy-column-ids.ts
       'col_notes', to_jsonb(li.notes)
     ));

-- =============================================================================
-- Seed default template for every company
-- Seed for all companies so the builder is immediately usable — not just companies with existing offers.
-- =============================================================================
INSERT INTO public.angebot_vorlagen (company_id, name, description, is_default, columns, updated_at)
SELECT
  c.id,
  'Standard',
  NULL,
  true,
  -- col_position is never stored here — it is injected automatically at render time.
  -- See ANGEBOT_POSITION_COLUMN in src/features/angebote/lib/angebot-auto-columns.ts
  jsonb_build_array(
    jsonb_build_object(
      'id', 'col_leistung',
      'header', 'Leistung',
      'type', 'text',
      'weight', 3,
      'minWidth', 100,
      'required', false
    ),
    jsonb_build_object(
      'id', 'col_anfahrtkosten',
      'header', 'Anfahrtkosten',
      'type', 'currency',
      'weight', 1,
      'minWidth', 52,
      'required', false
    ),
    jsonb_build_object(
      'id', 'col_price_first_5km',
      'header', 'erste 5 km (je km)',
      'type', 'currency_per_km',
      'weight', 1,
      'minWidth', 52,
      'required', false
    ),
    jsonb_build_object(
      'id', 'col_price_per_km_after_5',
      'header', 'ab 5 km (je km)',
      'type', 'currency_per_km',
      'weight', 1,
      'minWidth', 52,
      'required', false
    ),
    jsonb_build_object(
      'id', 'col_notes',
      'header', 'Hinweis',
      'type', 'text',
      'weight', 1,
      'minWidth', 80,
      'required', false
    )
  ),
  now()
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.angebot_vorlagen av WHERE av.company_id = c.id
);

-- =============================================================================
-- RLS (mirror angebote: admin + company_id)
-- =============================================================================
ALTER TABLE public.angebot_vorlagen ENABLE ROW LEVEL SECURITY;

-- mirrors angebote / angebot_line_items company isolation pattern
CREATE POLICY angebot_vorlagen_select_company_admin ON public.angebot_vorlagen
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- mirrors angebote / angebot_line_items company isolation pattern
CREATE POLICY angebot_vorlagen_insert_company_admin ON public.angebot_vorlagen
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- mirrors angebote / angebot_line_items company isolation pattern
CREATE POLICY angebot_vorlagen_update_company_admin ON public.angebot_vorlagen
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

-- mirrors angebote / angebot_line_items company isolation pattern
CREATE POLICY angebot_vorlagen_delete_company_admin ON public.angebot_vorlagen
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.angebot_vorlagen TO authenticated, service_role;

-- Remove col_position from any angebot_vorlagen.columns arrays that were seeded incorrectly.
-- col_position is auto-injected at render time and must never be stored.
-- One-time cleanup for rows seeded with col_position before the auto-inject pattern was established.
UPDATE public.angebot_vorlagen
SET columns = COALESCE(
  (
    SELECT jsonb_agg(col)
    FROM jsonb_array_elements(columns) AS col
    WHERE col->>'id' != 'col_position'
  ),
  '[]'::jsonb
)
WHERE columns @> '[{"id":"col_position"}]'::jsonb;

-- Same cleanup for any table_schema_snapshot on angebote rows.
-- One-time cleanup for rows seeded with col_position before the auto-inject pattern was established.
UPDATE public.angebote
SET table_schema_snapshot = COALESCE(
  (
    SELECT jsonb_agg(col)
    FROM jsonb_array_elements(table_schema_snapshot) AS col
    WHERE col->>'id' != 'col_position'
  ),
  '[]'::jsonb
)
WHERE table_schema_snapshot IS NOT NULL
  AND table_schema_snapshot @> '[{"id":"col_position"}]'::jsonb;
