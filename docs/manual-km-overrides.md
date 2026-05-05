# Manual KM overrides

## Overview

Some routes return wrong distances from the routing provider (construction, ferry shortcuts, or Kostenträger-mandated paths). This feature introduces a **resolved effective distance** used for VAT (§12 Abs. 2 Nr. 10 UStG tiering) and per-km pricing, while **never overwriting** `trips.driving_distance_km` (the Google / provider value stays the audit reference).

Implementation is split across phases:

- **Phase 1 (done):** Database columns, `client_km_overrides` table, pure `resolveEffectiveDistanceKm`, `buildLineItemsFromTrips` uses effective km internally, `invoice_line_items` stores `effective_distance_km` and `original_distance_km` snapshots. Existing behaviour is unchanged when overrides are absent (all new fields NULL / empty).

- **Phase 2 (done):** Step 3 inline KM editing when `payers.manual_km_enabled` is true (set in DB); fire-and-forget writeback of `trips.manual_distance_km` on invoice save; “KM manuell” badge and reset; VAT tier updates from committed km (per-km repricing deferred to Phase 3).

- **Phase 3 (done):** `payers.manual_km_enabled` toggle in Kostenträger detail (`payer-details-sheet`), `client_km_overrides` CRUD in Fahrgast detail via `PricingRuleDialog` / `ClientKmOverrideStep`, batch load of active overrides in `fetchTripsForBuilder`, optional `billing_variant_id` on override rows (migration `20260506120000_client_km_overrides_billing_variant.sql`), resolver precedence variant → payer-wide → global, `BuilderLineItem.resolved_rule` for full per-km repricing on KM edits (Taxameter / `manual_gross_price` still only gets tax + Anfahrt sync), PDF `distance_km` column bound to **`effective_distance_km`** for billed km totals.

## Resolution chain

Priority (most specific wins):

1. **`trips.manual_distance_km`** — Admin-confirmed distance from a prior invoice commit (Phase 2). Strongest signal: human approved this km for billing on this trip.

2. **`client_km_overrides`** — Catalog of fixed km per client. Scope matches `client_price_tags`: optional **`billing_variant_id`** (Unterart), optional **`payer_id`** (all variants under that payer when variant is null), or both null for global. Precedence when several rows match: **variant + payer** match on trip → **variant-only** (row `payer_id` null) → **payer-wide** (`payer_id` set, `billing_variant_id` null) → **global** (both null). Only `is_active = true` rows participate.

3. **`trips.driving_distance_km`** — Routing provider distance. Immutable for this feature; always the fallback.

Pure implementation: [`src/features/invoices/lib/resolve-effective-distance.ts`](../src/features/invoices/lib/resolve-effective-distance.ts).

## Database schema

| Object | Column / table | Purpose |
|--------|----------------|---------|
| `payers` | `manual_km_enabled` | When true, Step 3 shows manual KM controls for trips under this payer. Default false. Toggle in Kostenträger detail sheet. |
| `trips` | `manual_distance_km` | Nullable admin override km; Phase 2 writeback. Does not replace `driving_distance_km`. |
| `invoice_line_items` | `effective_distance_km` | Km used for pricing/VAT/PDF math for this line; frozen at insert. |
| `invoice_line_items` | `original_distance_km` | Snapshot of `trips.driving_distance_km` at insert; audit / display. |
| `client_km_overrides` | table | Tenant-scoped rows: `company_id`, `client_id`, optional `payer_id`, optional `billing_variant_id` (FK `billing_variants`, `ON DELETE CASCADE`), `distance_km`, `is_active`, timestamps. RLS mirrors `client_price_tags`. |

## Phase status

| Phase | Scope | Status |
|-------|--------|--------|
| 1 | Schema, resolver, builder + insert snapshots, docs | Complete |
| 2 | Step 3 UI, writeback to `trips.manual_distance_km` | Complete |
| 3 | Payer toggle, client override CRUD + variant scope, fetch overrides, repricing, PDF effective km | Complete |

## Step 3 UX (Phase 2)

- **Collapsed row:** Three columns — left (position, Fahrgast, date) unchanged; **middle** — muted routing km (`original_distance_km`, fallback `distance_km`), optional small km input when `manual_km_enabled`, amber “KM manuell” + reset when `isManualKmOverride`; **right** — gross/Anfahrt editing unchanged (no km label under price).
- **Expanded panel:** Pickup and dropoff addresses first (moved from collapsed header), then existing time, strategy badge, MwSt, Anfahrt, net breakdown.
- **Collapsible:** Closing a row while price **or** km inputs have draft local state is blocked the same way as today (`openRows` not updated on `onOpenChange(false)` when either edit mode is active).
- **Writeback:** On successful invoice create, `trips.manual_distance_km` is set fire-and-forget for lines with `isManualKmOverride` and `manualDistanceKm`; `driving_distance_km` is never written.
- **Phase 3 repricing:** Changing committed km in Step 3 re-runs `resolveTripPrice` against `resolved_rule` (frozen billing rule snapshot) when the line is not Taxameter (`price_resolution.source !== 'manual_gross_price'`). **Reset KM** restores `originalPriceResolution` and routing-based distance fields like gross reset.

## Related docs

- [pricing-engine.md](pricing-engine.md) — `buildLineItemsFromTrips` effective km before tax/pricing.
- [invoices-module.md](invoices-module.md) — Line item snapshots and Storno mirroring.
