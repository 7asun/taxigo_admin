-- Phase 2 (Option A): convert trips.net_price from a manually
-- maintained column to a PostgreSQL generated column.
--
-- net_price is now always derived from base_net_price + approach_fee_net.
-- Application code must never write net_price directly — PostgreSQL
-- will reject any attempt with: "column net_price can only be updated
-- to DEFAULT".
--
-- COALESCE(..., 0) is intentional: unpriced trips (both components null)
-- surface as net_price = 0 rather than NULL, preserving existing
-- behaviour for dashboard, stats-utils, occupancy-utils, and CSV export.
-- Do not change to NULL propagation without updating all readers.
--
-- All existing readers (stats-utils, occupancy-utils, csv-export,
-- unassigned-trips, dashboard) are unaffected — they continue to
-- SELECT net_price and receive the correct combined total.

ALTER TABLE public.trips DROP COLUMN IF EXISTS net_price;

ALTER TABLE public.trips
  ADD COLUMN net_price numeric(10,4)
    GENERATED ALWAYS AS (
      COALESCE(base_net_price, 0) + COALESCE(approach_fee_net, 0)
    ) STORED;

COMMENT ON COLUMN public.trips.net_price IS
  'Generated column: COALESCE(base_net_price, 0) + COALESCE(approach_fee_net, 0). '
  'Read-only — do not include in INSERT or UPDATE payloads. '
  'Phase 2 (Option A, 2026-04-25). Write base_net_price + approach_fee_net instead.';
