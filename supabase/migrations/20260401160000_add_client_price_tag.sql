-- ============================================================
-- Migration: add_client_price_tag
--
-- Adds the price_tag column to the clients table.
-- This field stores the default price for all trips of a client,
-- taking precedence over manually entered trip prices.
--
-- Precedence hierarchy (highest to lowest):
--   1. clients.price_tag — primary source, set at client level
--   2. trips.price — fallback, manually entered per trip
--   3. null — requires manual entry during invoicing
--
-- Run once in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Add price_tag column to clients table
-- Type: NUMERIC(10,2) to match trips.price precision
-- Nullable: not all clients have fixed pricing; allows gradual adoption
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS price_tag NUMERIC(10,2);

-- ════════════════════════════════════════════════════════════
-- Column comments — TABLE: clients (price_tag addition)
-- ════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.clients.price_tag IS
$$Default price for all trips of this client. Used as primary source
when building invoices. Takes precedence over trips.price.

If set, all trips for this client will use this price automatically.
If null, falls back to the manually entered price in trips.price.
If both are null, the dispatcher must enter a price during invoicing.

Type: NUMERIC(10,2) — standard EUR currency precision.
Nullable by design to support gradual adoption.$$;

