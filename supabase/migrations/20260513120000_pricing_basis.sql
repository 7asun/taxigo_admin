-- Why: catalog rules previously had no explicit net/gross declaration on stored amounts.
-- Default 'net' preserves all existing row semantics without a data rewrite.

CREATE TYPE public.pricing_basis_enum AS ENUM ('net', 'gross');

ALTER TABLE public.billing_pricing_rules
  ADD COLUMN pricing_basis public.pricing_basis_enum NOT NULL DEFAULT 'net';

COMMENT ON COLUMN public.billing_pricing_rules.pricing_basis IS
  'Declares whether monetary values in config (km tiers, fixed fees, time fees)
   are net (excl. VAT) or gross (incl. VAT). approach_fee_net is always net
   regardless of this setting. client_price_tag rows ignore this field.';
