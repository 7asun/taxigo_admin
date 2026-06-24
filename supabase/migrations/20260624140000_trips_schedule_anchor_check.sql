-- Pre-apply verify: must return 0 before constraint lands.
-- SELECT COUNT(*) FROM trips
-- WHERE scheduled_at IS NULL AND requested_date IS NULL;
-- Expected: 0

-- WHY: Enforces the schedule anchor invariant at DB level. Every trip row must
-- have at least one calendar anchor: timed (scheduled_at) or date-only
-- (requested_date). Both-null rows were repaired in
-- 20260624120000_repair_anchorless_return_legs.sql. Write paths hardened in
-- v4d Phase 1 (return legs) and Phase 2 (reschedule both-blank guard).

ALTER TABLE trips
  ADD CONSTRAINT trips_schedule_anchor_check
  CHECK (
    scheduled_at IS NOT NULL
    OR requested_date IS NOT NULL
  );

-- Post-apply verify: constraint exists.
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'trips'::regclass
--   AND contype = 'c'
--   AND conname = 'trips_schedule_anchor_check';
-- Expected: 1 row
