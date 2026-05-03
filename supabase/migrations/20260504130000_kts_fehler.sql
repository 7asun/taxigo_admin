-- Extend trips table with KTS error tracking fields
-- kts_fehler: flags that the KTS document associated with this trip has an error
-- kts_fehler_beschreibung: freetext description of the error, only relevant when kts_fehler is true

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_fehler boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kts_fehler_beschreibung text DEFAULT null;

COMMENT ON COLUMN public.trips.kts_fehler IS
  'True when the KTS document for this trip is flagged as erroneous (operational).';

COMMENT ON COLUMN public.trips.kts_fehler_beschreibung IS
  'Optional free-text description of the KTS error; cleared when kts_fehler is false.';
