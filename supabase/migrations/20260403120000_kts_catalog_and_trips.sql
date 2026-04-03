-- KTS (Krankentransportschein): catalog defaults + trip operational flag.
-- See docs/kts-architecture.md

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS kts_default boolean DEFAULT NULL;

COMMENT ON COLUMN public.payers.kts_default IS
  'NULL = unset (inherit). TRUE/FALSE = default KTS applies when Unterart and Familie do not set kts_default.';

ALTER TABLE public.billing_variants
  ADD COLUMN IF NOT EXISTS kts_default boolean DEFAULT NULL;

COMMENT ON COLUMN public.billing_variants.kts_default IS
  'NULL = unset (inherit). TRUE/FALSE = default KTS for this Unterart; wins over behavior_profile.kts_default and payers.kts_default.';

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_document_applies boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kts_source text DEFAULT NULL;

COMMENT ON COLUMN public.trips.kts_document_applies IS
  'Operational: Krankentransportschein / KTS clearing applies to this trip.';

COMMENT ON COLUMN public.trips.kts_source IS
  'variant | familie | payer | manual | system_default — how kts_document_applies was set.';

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS kts_document_applies boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kts_source text DEFAULT NULL;

COMMENT ON COLUMN public.recurring_rules.kts_document_applies IS
  'Copied onto trips generated from this rule.';

COMMENT ON COLUMN public.recurring_rules.kts_source IS
  'Copied onto generated trips together with kts_document_applies.';
