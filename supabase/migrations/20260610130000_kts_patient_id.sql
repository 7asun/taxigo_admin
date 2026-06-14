-- KTS PR3: external patient ID on clients (master) and trips (snapshot for PR4 CSV matching).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS kts_patient_id text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_patient_id text;

COMMENT ON COLUMN public.clients.kts_patient_id IS
  'External KTS patient ID from the accountant billing system; master value for client profile.';

COMMENT ON COLUMN public.trips.kts_patient_id IS
  'Snapshot of patient ID at KTS enable / client link time — stable for PR4 CSV matching; not cleared when KTS is turned off.';
