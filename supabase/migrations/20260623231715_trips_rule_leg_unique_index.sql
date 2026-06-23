-- WHY: prevents duplicate rule legs from concurrent cron runs
-- or re-runs after NULL-key splits. Without this index the
-- app-level dedup in findExistingRecurringLegId cannot prevent
-- races between two simultaneous generateRecurringTrips() calls.
--
-- Partial on requested_date IS NOT NULL: legacy timeless rows
-- may have NULL requested_date and must not be blocked.
-- status filter: allows re-scheduling on same date after
-- cancellation (cancelled/completed rows excluded).
--
-- This index becomes the hard safety net once v4a code is live.
-- The ≥2 branch in findExistingRecurringLegId handles any
-- surviving duplicates until they are cleaned manually.
--
-- PRE-FLIGHT (2026-06-23): apply only after duplicate merge —
-- active rows still have >1 per (rule_id, requested_date, client_id, link_type)
-- for Ingrid Schultz (2026-06-25/26) and Kira (2026-06-23 outbound).

CREATE UNIQUE INDEX IF NOT EXISTS trips_rule_leg_unique
  ON trips (rule_id, requested_date, client_id, link_type)
  WHERE requested_date IS NOT NULL
    AND status NOT IN ('cancelled', 'completed');
