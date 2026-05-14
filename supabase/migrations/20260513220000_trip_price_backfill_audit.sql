-- Why: stores recalculated prices alongside current values for human review
-- before any production trip rows are modified. Drop after audit is complete.

CREATE TABLE IF NOT EXISTS trip_price_backfill_audit (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                   uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  company_id                uuid NOT NULL,

  -- Current stored values (snapshot at audit time)
  current_gross_price       numeric,
  current_net_price         numeric,
  current_base_net_price    numeric,
  current_approach_fee_net  numeric,
  current_tax_rate          numeric,

  -- Recalculated values using updated pricing_basis logic
  recalc_gross_price        numeric,
  recalc_net_price          numeric,
  recalc_base_net_price     numeric,
  recalc_approach_fee_net   numeric,
  recalc_tax_rate           numeric,

  -- Delta for quick review
  gross_price_delta         numeric GENERATED ALWAYS AS
                              (recalc_gross_price - current_gross_price) STORED,
  net_price_delta           numeric GENERATED ALWAYS AS
                              (recalc_net_price - current_net_price) STORED,

  -- Metadata
  pricing_basis_used        text,   -- 'net' or 'gross' from the matched rule
  strategy_used             text,   -- which strategy resolved for this trip
  rule_id                   uuid,   -- which billing_pricing_rules row matched
  audited_at                timestamptz DEFAULT now(),
  needs_update              boolean GENERATED ALWAYS AS
                              (round(recalc_gross_price::numeric, 2) <>
                               round(current_gross_price::numeric, 2)) STORED
);

COMMENT ON TABLE trip_price_backfill_audit IS
  'Temporary audit table for pricing_basis backfill review. Drop after backfill
   is confirmed correct with: DROP TABLE trip_price_backfill_audit;';
