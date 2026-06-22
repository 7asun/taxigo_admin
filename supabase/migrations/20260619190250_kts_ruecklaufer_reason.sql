-- KTS PR4.2: persist optional admin reason when marking a Belegnummer as ruecklaufer.
-- why: audit trail for "why was this flagged?" — cleared on resolve (reimport or manual abgerechnet).

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_ruecklaufer_reason text;

COMMENT ON COLUMN public.trips.kts_ruecklaufer_reason IS
  'Optional admin note from mark_belegnummer_ruecklaufer (PR4.2). '
  'Set on all abgerechnet trips in the group; cleared when status returns to abgerechnet. '
  'NULL when not ruecklaufer or no reason given.';
