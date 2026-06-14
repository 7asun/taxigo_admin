-- KTS PR3.1: explicit document workflow state on trips.
-- See docs/kts-architecture.md §3.4 and docs/plans/kts-pr3-1-status-audit.md.

CREATE TYPE public.kts_status AS ENUM (
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben'
);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_status public.kts_status DEFAULT NULL;

COMMENT ON COLUMN public.trips.kts_status IS
  'Current physical state of the KTS document. '
  'NULL when kts_document_applies is false. '
  'ungeprueft is set automatically when KTS is enabled. '
  'uebergeben is set by PR3.3 handover batch.';

-- Backfill: never auto-assign korrekt or uebergeben — those require explicit admin action.
UPDATE public.trips t
SET kts_status = CASE
  WHEN NOT t.kts_document_applies THEN NULL
  WHEN t.kts_fehler AND EXISTS (
    SELECT 1 FROM public.kts_corrections kc
    WHERE kc.trip_id = t.id
      AND kc.received_at IS NULL
  ) THEN 'in_korrektur'::public.kts_status
  WHEN t.kts_fehler THEN 'fehlerhaft'::public.kts_status
  ELSE 'ungeprueft'::public.kts_status
END;

-- Align kts_fehler with backfilled status (~40 read paths depend on this boolean).
UPDATE public.trips
SET kts_fehler = (kts_status IN ('fehlerhaft', 'in_korrektur'))
WHERE kts_document_applies = true;

CREATE INDEX IF NOT EXISTS idx_trips_company_kts_status
  ON public.trips (company_id, kts_status)
  WHERE kts_document_applies = true;
