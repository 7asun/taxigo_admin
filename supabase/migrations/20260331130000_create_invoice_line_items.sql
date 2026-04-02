-- ============================================================
-- Migration: create_invoice_line_items
--
-- Creates the invoice_line_items table. Each row is one position
-- (Rechnungsposition) on an invoice — typically one trip, but
-- can also be a manually entered item.
--
-- CRITICAL DESIGN PRINCIPLE — IMMUTABLE SNAPSHOTS:
--   Line items store a snapshot of trip data at the time the
--   invoice was created. They are intentionally decoupled from
--   the live `trips` table. Edits to trips after invoicing do
--   NOT change issued invoices. This is correct behaviour —
--   invoices are legal documents under German commercial law.
--
--   For display and PDF rendering: always use the snapshot
--   fields (client_name, pickup_address, etc.) — never JOIN
--   back to trips.
--
-- Linked to:
--   invoices → invoice_id (parent, CASCADE delete)
--   trips    → trip_id   (source, nullable for manual items)
--
-- Run once in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_line_items (

  -- ── Identity ──────────────────────────────────────────────
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent invoice. ON DELETE CASCADE: deleting a draft invoice
  -- automatically removes all its line items.
  invoice_id            UUID          NOT NULL
                          REFERENCES public.invoices(id) ON DELETE CASCADE,

  -- Source trip. Nullable: manually-added line items have no linked trip.
  -- INFORMATIONAL ONLY — do not JOIN to trips for invoice display.
  -- Use the snapshot fields below instead.
  trip_id               UUID
                          REFERENCES public.trips(id),

  -- ── Display Order ─────────────────────────────────────────
  -- Controls the order of positions on the invoice PDF. 1-based.
  -- Typically sorted by line_date ascending.
  position              INTEGER       NOT NULL,

  -- ── Trip Data Snapshot (Immutable after creation) ─────────
  -- All fields below are copied from the trip at invoice creation time.

  -- Date of the trip (from trips.scheduled_at, date part only).
  -- Used for display on the invoice as "Datum der Leistung" (§14 UStG).
  line_date             DATE,

  -- Human-readable description for this position.
  -- Auto-generated from trip data; editable in the builder before finalizing.
  -- Example: "Krankenfahrt vom 01.03.2026, Musterstraße → Klinikum".
  description           TEXT          NOT NULL,

  -- Passenger name at the time of invoicing.
  -- Snapshot of trips.client_name (which is itself a copy of clients.last_name etc.)
  client_name           TEXT,

  -- Full pickup address string, snapshot of trips.pickup_address.
  pickup_address        TEXT,

  -- Full dropoff address string, snapshot of trips.dropoff_address.
  dropoff_address       TEXT,

  -- Driving distance in km, snapshot of trips.driving_distance_km.
  -- Used for: tax rate determination + per-km price calculation (Phase 2).
  -- NULL triggers a warning in the invoice builder UI.
  distance_km           NUMERIC(8,2),

  -- ── Pricing ───────────────────────────────────────────────
  -- Price per unit. Meaning depends on the pricing method:
  --   manual:   direct trip price as entered by the driver (trips.price)
  --   per_km:   rate per km from the payer's rate card (Phase 2)
  --   fixed:    fixed price per trip from the rate card (Phase 2)
  unit_price            NUMERIC(10,4) NOT NULL,

  -- Quantity. Usually 1 (one trip).
  -- For per-km pricing: quantity = distance_km (so total = rate × distance).
  quantity              NUMERIC(8,2)  NOT NULL DEFAULT 1,

  -- Total price for this line = unit_price × quantity.
  -- Stored as an immutable snapshot — not recalculated from unit_price × quantity
  -- after creation, so price changes do not silently alter issued invoices.
  total_price           NUMERIC(10,2) NOT NULL,

  -- ── Tax Rate ──────────────────────────────────────────────
  -- Applied MwSt rate for this line item, stored as a decimal fraction.
  -- Examples: 0.07 = 7%, 0.19 = 19%.
  --
  -- Rule (§12 Abs. 2 Nr. 10 UStG — Personenbeförderung):
  --   distance_km <  50 → 0.07 (ermäßigter Steuersatz)
  --   distance_km >= 50 → 0.19 (Regelsteuersatz)
  --   distance_km = NULL → 0.07 (safe fallback) + UI warning in builder
  --
  -- Logic lives in: src/features/invoices/lib/tax-calculator.ts
  -- ⚠️ Update tax-calculator.ts (not this schema) when rules change.
  tax_rate              NUMERIC(5,4)  NOT NULL,

  -- ── Billing Classification Snapshot ───────────────────────
  -- Copied from billing_variants at invoice creation time.
  -- The code is stable (used in external payer systems / CSV exports).
  billing_variant_code  TEXT,         -- Stable code, e.g. "V01" from billing_variants.code
  billing_variant_name  TEXT,         -- Display name at time of invoicing, e.g. "Vollversorgung"

  -- ── Timestamps ────────────────────────────────────────────
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────

-- Fetch all line items for an invoice (most common query)
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id
  ON public.invoice_line_items (invoice_id);

-- Check if a specific trip has already been invoiced
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_trip_id
  ON public.invoice_line_items (trip_id);

-- Order by position when rendering the invoice (composite index)
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_position
  ON public.invoice_line_items (invoice_id, position);


-- ════════════════════════════════════════════════════════════
-- Column comments — TABLE: invoice_line_items
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE public.invoice_line_items IS
$$One row per position (Rechnungsposition) on an invoice.
Typically one row per trip, but can also be a manual entry.

All trip-derived fields (client_name, addresses, distance_km, etc.)
are IMMUTABLE SNAPSHOTS copied at invoice creation time.
Never JOIN back to trips for invoice display — use these snapshots.
This ensures invoices remain legally stable even if trip data changes.$$;

COMMENT ON COLUMN public.invoice_line_items.id IS
$$Primary key (UUID). Auto-generated on insert.$$;

COMMENT ON COLUMN public.invoice_line_items.invoice_id IS
$$FK → invoices.id. The parent invoice this position belongs to.
CASCADE DELETE: removing a draft invoice removes all its line items.$$;

COMMENT ON COLUMN public.invoice_line_items.trip_id IS
$$FK → trips.id. The source trip this position was built from.
NULLABLE — manual line items (not linked to a trip) have NULL here.
INFORMATIONAL ONLY: do not use this FK for invoice display.
Use the snapshot fields (description, client_name, etc.) instead.

Future use (Phase 3): used to mark trips as invoiced
  (trips.invoice_id FK) to prevent double-billing.$$;

COMMENT ON COLUMN public.invoice_line_items.position IS
$$Display order of this position on the invoice PDF. 1-based integer.
Normally sorted by line_date ascending, then by this field.$$;

COMMENT ON COLUMN public.invoice_line_items.line_date IS
$$Date of the transport service (from trips.scheduled_at, date part).
Printed as "Datum der Leistung" on the invoice per §14 UStG.
NULL for manual items where no date is relevant.$$;

COMMENT ON COLUMN public.invoice_line_items.description IS
$$Human-readable description for this position.
Auto-generated from trip data; editable in the builder.
Example: "Krankenfahrt vom 01.03.2026, Musterstraße 1 → Klinikum".$$;

COMMENT ON COLUMN public.invoice_line_items.client_name IS
$$Snapshot of the passenger's name at time of invoicing.
Copied from trips.client_name. Not updated if client record changes.$$;

COMMENT ON COLUMN public.invoice_line_items.pickup_address IS
$$Snapshot of the full pickup address string.
Copied from trips.pickup_address at invoice creation.$$;

COMMENT ON COLUMN public.invoice_line_items.dropoff_address IS
$$Snapshot of the full dropoff address string.
Copied from trips.dropoff_address at invoice creation.$$;

COMMENT ON COLUMN public.invoice_line_items.distance_km IS
$$Driving distance in km. Snapshot of trips.driving_distance_km.
Used for: (1) tax rate determination — see tax_rate comment,
          (2) per-km price calculation (Phase 2 rate cards).
NULL = distance was not recorded; triggers a warning in the builder.$$;

COMMENT ON COLUMN public.invoice_line_items.unit_price IS
$$Price per unit (Einzelpreis). Meaning depends on pricing method:
  manual:  trips.price as entered by the driver
  per_km:  payer rate card price per km (Phase 2)
  fixed:   payer rate card fixed price per trip (Phase 2)
Stored with 4 decimal places (NUMERIC 10,4) for km-rate precision.$$;

COMMENT ON COLUMN public.invoice_line_items.quantity IS
$$Quantity for this line.
  Normal trips:    1 (one trip = one position)
  Per-km pricing:  distance_km (so total = rate/km × distance_km)
Stored as NUMERIC to support fractional km quantities.$$;

COMMENT ON COLUMN public.invoice_line_items.total_price IS
$$Total for this line = unit_price × quantity.
Stored as an immutable snapshot at creation time.
Do NOT recalculate from unit_price × quantity after creation.$$;

COMMENT ON COLUMN public.invoice_line_items.tax_rate IS
$$MwSt rate applied to this line, stored as a decimal fraction.
  0.07 = 7%  (ermäßigter Steuersatz — trips under 50 km)
  0.19 = 19% (Regelsteuersatz — trips 50 km or more)

Rule (§12 Abs. 2 Nr. 10 UStG):
  distance_km <  50 → 0.07
  distance_km >= 50 → 0.19
  distance_km NULL  → 0.07 (fallback, with UI warning)

⚠️ All tax logic lives in: src/features/invoices/lib/tax-calculator.ts
   Update ONLY that file when rules change. Do not hardcode rates elsewhere.$$;

COMMENT ON COLUMN public.invoice_line_items.billing_variant_code IS
$$Stable code from billing_variants.code at time of invoicing.
Example: "V01". Used for mapping to external payer systems and CSV exports.
Stored as snapshot — does not change if billing_variants.code is later edited.$$;

COMMENT ON COLUMN public.invoice_line_items.billing_variant_name IS
$$Display name from billing_variants.name at time of invoicing.
Example: "Vollversorgung". Snapshot — does not change retroactively.$$;

COMMENT ON COLUMN public.invoice_line_items.created_at IS
$$Timestamp (UTC) when this line item was created.$$;
