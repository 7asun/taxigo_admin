-- Migration: angebot_vorlagen + angebote — column preset system
-- Transforms legacy { type, weight, minWidth } column objects to { preset } shape.
-- percent type → percent preset (first-class; renders as X% in PDF and detail view).
-- text weight>=3 → beschreibung (fill), text weight<3 → notiz (auto flex 2).
-- Safe to re-run (idempotent via jsonb_path_exists check).
-- Runtime API bridge: normalizeLegacyColumn in angebot-column-presets.ts handles
--   rows not yet migrated. Remove bridge after verifying on all environments.

-- =============================================================================
-- angebot_vorlagen.columns
-- =============================================================================
UPDATE public.angebot_vorlagen
SET columns = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', col->>'id',
          'header', LEFT(COALESCE(col->>'header', ''), 20),
          'preset',
            CASE
              WHEN col->>'type' = 'currency' THEN 'betrag'
              WHEN col->>'type' = 'currency_per_km' THEN 'preis_km'
              WHEN col->>'type' = 'integer' THEN 'anzahl'
              WHEN col->>'type' = 'percent' THEN 'percent' /* percent mapped to percent preset — first-class preset, no data corruption risk */
              WHEN col->>'type' = 'text' AND COALESCE((col->>'weight')::int, 0) >= 3 THEN 'beschreibung'
              WHEN col->>'type' = 'text' THEN 'notiz'
              ELSE 'notiz'
            END,
          'required', (col->'required'),
          'formula', (col->'formula')
        )
      )
    )
    FROM jsonb_array_elements(columns) AS col
  ),
  '[]'::jsonb
)
WHERE jsonb_path_exists(columns, '$[*].type');

-- =============================================================================
-- angebote.table_schema_snapshot
-- =============================================================================
UPDATE public.angebote
SET table_schema_snapshot = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', col->>'id',
          'header', LEFT(COALESCE(col->>'header', ''), 20),
          'preset',
            CASE
              WHEN col->>'type' = 'currency' THEN 'betrag'
              WHEN col->>'type' = 'currency_per_km' THEN 'preis_km'
              WHEN col->>'type' = 'integer' THEN 'anzahl'
              WHEN col->>'type' = 'percent' THEN 'percent' /* percent mapped to percent preset — first-class preset, no data corruption risk */
              WHEN col->>'type' = 'text' AND COALESCE((col->>'weight')::int, 0) >= 3 THEN 'beschreibung'
              WHEN col->>'type' = 'text' THEN 'notiz'
              ELSE 'notiz'
            END,
          'required', (col->'required'),
          'formula', (col->'formula')
        )
      )
    )
    FROM jsonb_array_elements(table_schema_snapshot) AS col
  ),
  '[]'::jsonb
)
WHERE table_schema_snapshot IS NOT NULL
  AND jsonb_path_exists(table_schema_snapshot, '$[*].type');

