-- Preview (run before applying — expect 9 rows):
-- SELECT r.id AS return_id, o.id AS outbound_id,
--   o.requested_date, o.scheduled_at
-- FROM trips r
-- JOIN trips o ON o.id = r.linked_trip_id
-- WHERE r.requested_date IS NULL AND r.scheduled_at IS NULL
--   AND r.link_type = 'return';

-- WHY: 9 bulk-upload auto-return stubs (2026-03-20 → 2026-03-27) have both
-- schedule fields NULL. Copy outbound Berlin calendar day; scheduled_at stays NULL.

UPDATE trips AS r
SET requested_date = COALESCE(
  o.requested_date,
  (o.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin')::date
)
FROM trips AS o
WHERE o.id = r.linked_trip_id
  AND r.requested_date IS NULL
  AND r.scheduled_at IS NULL
  AND r.link_type = 'return';

-- Run this after applying to verify repair:
-- SELECT COUNT(*) FROM trips
-- WHERE requested_date IS NULL AND scheduled_at IS NULL;
-- Expected: 0
