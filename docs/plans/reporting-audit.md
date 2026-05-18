# Reporting module — data audit

**Date:** 2026-05-18  
**Scope:** Read-only investigation of trips and related tables for a future company-wide and per-payer reporting module.  
**Sources:** All 91 files in `supabase/migrations/` (chronological order), `src/types/database.types.ts`, `src/features/invoices/types/*.ts`, `src/lib/supabase/*`, and docs under `docs/` (trips, billing, invoices, KTS, access control).

**Important limitation:** The repository does **not** contain the initial `CREATE TABLE public.trips` (or `clients`, `payers`, `accounts`) DDL. The `trips` shape below is the **effective schema** after applying every migration in this repo, cross-checked against `database.types.ts` (generated/hand-maintained Supabase types). Where migrations and types disagree, both are noted.

---

## 1. TRIPS TABLE — CORE FIELDS

### Column inventory (`public.trips`)

| Column | PostgreSQL type (effective) | Nullable | Notes |
|--------|----------------------------|----------|--------|
| `id` | `uuid` | NO | PK |
| `company_id` | `uuid` | YES | FK → `companies.id` |
| `status` | `text` | NO | No `CHECK` in repo migrations; values enforced in app (see §8) |
| `created_at` | `timestamptz` | YES | |
| `created_by` | `uuid` | YES | FK → `accounts.id` |
| `scheduled_at` | `timestamptz` | YES | Primary business datetime; may be NULL for “date-only” / bulk rows |
| `requested_date` | `date` | YES | Calendar day when `scheduled_at` is NULL or for consistency with imports |
| `actual_pickup_at` | `timestamptz` | YES | Driver-recorded actual pickup |
| `actual_dropoff_at` | `timestamptz` | YES | Driver-recorded actual dropoff |
| `driver_id` | `uuid` | YES | FK → `accounts.id` (role `driver`) |
| `vehicle_id` | `uuid` | YES | FK → `vehicles.id` |
| `client_id` | `uuid` | YES | FK → `clients.id` |
| `client_name` | `text` | YES | Denormalized snapshot on trip |
| `client_phone` | `text` | YES | Denormalized snapshot on trip |
| `payer_id` | `uuid` | YES | FK → `payers.id` |
| `billing_variant_id` | `uuid` | YES | FK → `billing_variants.id`, `ON DELETE SET NULL` |
| `billing_type_id` | `uuid` | YES | FK → `billing_types.id`; re-added in `20260418120000_trips-price-schema.sql` after an earlier drop in `20260326120000` |
| `billing_calling_station` | `text` | YES | Billing metadata (not passenger station) |
| `billing_betreuer` | `text` | YES | Billing metadata |
| `pickup_address` | `text` | YES | |
| `pickup_street` | `text` | YES | `20240316000000_add_structured_addresses_to_trips.sql` |
| `pickup_street_number` | `text` | YES | |
| `pickup_zip_code` | `text` | YES | |
| `pickup_city` | `text` | YES | |
| `pickup_station` | `text` | YES | Passenger-facing station label |
| `pickup_lat` / `pickup_lng` | `double precision` | YES | |
| `pickup_place_id` | `text` | YES | `20260504120000_add-place-ids-to-trips.sql` |
| `pickup_location` | `jsonb` | YES | Legacy/geo blob |
| `dropoff_address` | `text` | YES | |
| `dropoff_street` | `text` | YES | |
| `dropoff_street_number` | `text` | YES | |
| `dropoff_zip_code` | `text` | YES | |
| `dropoff_city` | `text` | YES | |
| `dropoff_station` | `text` | YES | |
| `dropoff_lat` / `dropoff_lng` | `double precision` | YES | |
| `dropoff_place_id` | `text` | YES | |
| `dropoff_location` | `jsonb` | YES | |
| `driving_distance_km` | `double precision` | YES | From routing (e.g. Google Directions); `20260316090000` |
| `driving_duration_seconds` | `integer` | YES | Same source as distance; **not** `driving_duration_min` |
| `manual_distance_km` | `numeric` | YES | Admin override for pricing km; `20260505180000` |
| `gross_price` | `numeric(10,4)` | YES | |
| `tax_rate` | `numeric` | YES | e.g. 0.07 / 0.19 |
| `base_net_price` | `numeric(10,4)` | YES | Transport net only; `20260424100000` |
| `approach_fee_net` | `numeric(10,4)` | YES | Anfahrt net; `20260424100000` |
| `net_price` | `numeric(10,4)` | NO | **GENERATED STORED:** `COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0)`; read-only (`20260425120000`) |
| `manual_gross_price` | `numeric` | YES | Taxameter / admin gross override; `20260423100000` |
| `is_wheelchair` | `boolean` | NO | Default `false`; trip-level flag (also on `clients`) |
| `kts_document_applies` | `boolean` | NO | Default `false`; `20260403120000` |
| `kts_source` | `text` | YES | See §4 |
| `kts_fehler` | `boolean` | NO | Default `false`; `20260504130000` |
| `kts_fehler_beschreibung` | `text` | YES | Cleared when `kts_fehler` is false |
| `reha_schein` | `boolean` | NO | Default `false`; `20260514120000` |
| `no_invoice_required` | `boolean` | NO | Default `false`; `20260404103000` |
| `no_invoice_source` | `varchar(20)` | YES | Cascade source for no-invoice flag |
| `selbstzahler_collected_amount` | `numeric(10,2)` | YES | Documented as future cash reporting; no UI in V1 |
| `fremdfirma_id` | `uuid` | YES | FK → `fremdfirmen.id` |
| `fremdfirma_payment_mode` | `text` | YES | CHECK when non-null (see §4) |
| `fremdfirma_cost` | `numeric(10,2)` | YES | |
| `greeting_style` | `text` | YES | e.g. du/Sie; `20260316100000` |
| `has_missing_geodata` | `boolean` | NO | Default `false`; bulk-upload flag |
| `needs_driver_assignment` | `boolean` | NO | Default `false`; bulk-upload flag |
| `ingestion_source` | `text` | YES | e.g. `csv_bulk_upload`, `manual_form` |
| `group_id` | `uuid` | YES | Kanban / multi-stop grouping |
| `stop_order` | `integer` | YES | Order within `group_id`; `20260317100000` |
| `stop_updates` | `jsonb` | NO | Default `{}` in types |
| `linked_trip_id` | `uuid` | YES | FK → `trips.id` (Hin/Rück pairs) |
| `link_type` | `text` | YES | App values: `outbound`, `return` (no DB CHECK in repo) |
| `return_status` | `text` | YES | Exported in CSV; no enum/CHECK in repo |
| `rule_id` | `uuid` | YES | FK → `recurring_rules.id` when generated from rule |
| `note` | `text` | YES | |
| `notes` | `text` | YES | Cancellation / driver notes (e.g. cancel RPC) |
| `canceled_reason_notes` | `text` | YES | |
| `payment_method` | `text` | YES | No CHECK in repo migrations |
| `needs_driver_assignment` | `boolean` | NO | |

### Enums on `trips`

**None** in PostgreSQL for `trips` columns in this repo. `database.types.ts` declares `Enums: {}` for the public schema.

### Distance / duration

| Field | Exists? | Type |
|-------|---------|------|
| `driving_distance_km` | **Yes** | `double precision`, nullable |
| `driving_duration_seconds` | **Yes** | `integer`, nullable (seconds, not minutes) |
| `manual_distance_km` | **Yes** | `numeric`, nullable (billing override) |

There is **no** `driving_duration_min` column. Duration for reporting should use `driving_duration_seconds / 60` or convert in SQL.

---

## 2. BILLING FIELDS

### `billing_type` vs `billing_variant`

These are **not PostgreSQL enums**. They are **catalog tables** scoped per Kostenträger (payer):

| Concept | Table | Trip FK | Semantics |
|---------|--------|---------|-----------|
| **Abrechnungsfamilie** (“billing family”) | `billing_types` | `trips.billing_type_id` (nullable; denormalized family at trip creation per `20260418120000`) | `name`, `color`, `behavior_profile` (JSON), `payer_id`, optional `rechnungsempfaenger_id`, `accepts_self_payment` |
| **Unterart** (“variant”) | `billing_variants` | `trips.billing_variant_id` (nullable; **leaf** selection in UI) | `name`, `code` (2–6 chars `[A-Z0-9]`), `billing_type_id`, `sort_order`, optional catalog defaults (`kts_default`, `no_invoice_required_default`) |

**Enum-like values:** There is **no fixed global list** of billing type or variant names/codes. Values are **per-tenant, per-payer** rows created in Admin (see `docs/billing-families-variants.md`). CSV matching uses `billing_types.name` and `billing_variants.code` / `name` within the family.

**Historical note:** `20260326120000` dropped `trips.billing_type_id`; `20260418120000` added it back as a denormalized reference “resolved from the billing variant at creation.”

### Price / amount fields (per trip)

| Field | Role |
|-------|------|
| `base_net_price` | Transport net (excl. Anfahrt) |
| `approach_fee_net` | Approach fee net |
| `net_price` | **Generated** total net (read-only) |
| `gross_price` | Stored gross when computed |
| `tax_rate` | VAT rate on trip |
| `manual_gross_price` | P0 taxameter override (all-in gross) |
| `selbstzahler_collected_amount` | Placeholder for cash collection reporting |

**How price is calculated:** Application engine in `src/features/invoices/lib/resolve-trip-price.ts` (priorities: taxameter → KTS €0 → client price tag → `billing_pricing_rules` strategy → `base_net_price` fallback). Trip snapshot fields are written via `computeTripPrice` (`src/features/trips/lib/trip-price-engine.ts`). Rules live in `billing_pricing_rules` (scoped to payer, billing_type, or billing_variant).

**Pricing rule strategies** (CHECK on `billing_pricing_rules.strategy`, not on trips):

`client_price_tag`, `tiered_km`, `fixed_below_threshold_then_km`, `time_based`, `manual_trip_price`, `no_price`

(Plus app-only resolution labels: `kts_override`, `trip_price_fallback`, `manual_gross_price`.)

**Per-km rates** are **not** columns on `trips`; they live in `billing_pricing_rules.config` JSONB (e.g. tier arrays).

### Invoice linkage (trip-level billing status)

Trips are **not** denormalized with `invoiced` / `paid` flags. Invoicing state is derived from **`invoice_line_items.trip_id`** → **`invoices.status`** (`draft`, `sent`, `paid`, `cancelled`, `corrected`). See §8 and `docs/invoices-module.md`.

---

## 3. PAYER FIELDS

### Relationship

- `trips.payer_id` → `payers.id` (nullable FK).
- One payer has many `billing_types`; each type has many `billing_variants`.
- Invoices are issued **to** a payer: `invoices.payer_id` NOT NULL.

There is **no** separate “payer type” enum. Distinction is:

1. **Kostenträger** — institution (`payers` row: name, number, defaults).
2. **Abrechnungsfamilie / Unterart** — billing classification under that payer (`billing_types` / `billing_variants`).

Optional **invoice recipient** is a different entity: `rechnungsempfaenger` (linked from payer or billing type/variant).

### `public.payers` columns (migrations + types)

| Column | Type | Nullable | Source |
|--------|------|----------|--------|
| `id` | `uuid` | NO | |
| `company_id` | `uuid` | NO | Multi-tenant scope |
| `name` | `text` | NO | Display / invoice name |
| `number` | `text` | YES | Internal reference (`05-kundennummer-system.sql` adds payer numbers) |
| `created_at` | `timestamptz` | NO | |
| `street` | `text` | YES | `20260331100000` — **not** in `database.types.ts` Row (types stale) |
| `street_number` | `text` | YES | same |
| `zip_code` | `text` | YES | same |
| `city` | `text` | YES | same |
| `contact_person` | `text` | YES | same |
| `email` | `text` | YES | same |
| `phone` | `text` | YES | same |
| `kts_default` | `boolean` | YES | Tri-state default: NULL = unset |
| `no_invoice_required_default` | `boolean` | YES | `20260404103000` |
| `rechnungsempfaenger_id` | `uuid` | YES | FK → `rechnungsempfaenger` |
| `accepts_self_payment` | `boolean` | YES | Selbstzahler default; `20260502120002` |
| `manual_km_enabled` | `boolean` | NO | Default false; payer gate for manual km UI |
| `reha_schein_enabled` | `boolean` | NO | Default false; gate for trip `reha_schein` UI; `20260514120000` |

**RLS:** Admin-only, `company_id = current_user_company_id()` (`20260409170000_add_missing_rls.sql`, `docs/access-control.md`).

---

## 4. MEDICAL / TRANSPORT FLAGS

| Flag | Column | Type | Default | Notes |
|------|--------|------|---------|--------|
| Reha-Schein | `reha_schein` | `boolean NOT NULL` | `false` | Shown only if `payers.reha_schein_enabled`; mirrored on `recurring_rules` |
| KTS document | `kts_document_applies` | `boolean NOT NULL` | `false` | Operational KTS case; separate from billing variant name |
| KTS provenance | `kts_source` | `text` | NULL | Documented values: `variant`, `familie`, `payer`, `manual`, `system_default` |
| KTS error | `kts_fehler` | `boolean NOT NULL` | `false` | QA / clearing error flag |
| KTS error text | `kts_fehler_beschreibung` | `text` | NULL | |
| No invoice | `no_invoice_required` | `boolean NOT NULL` | `false` | |
| No invoice source | `no_invoice_source` | `varchar(20)` | NULL | `variant`, `familie`, `payer`, `manual`, `system_default` |
| Fremdfirma | `fremdfirma_id` | `uuid` | NULL | External operator; own catalog |
| Fremdfirma payment | `fremdfirma_payment_mode` | `text` | NULL | CHECK: `cash_per_trip`, `monthly_invoice`, `self_payer`, `kts_to_fremdfirma` |
| Fremdfirma cost | `fremdfirma_cost` | `numeric(10,2)` | NULL | Seed for margin reporting |

**Wheelchair** is documented in §5 (`is_wheelchair`).

There is **no** `reha_schein` on payers—only `reha_schein_enabled` (gate) and `reha_schein` on trips/rules.

---

## 5. WHEELCHAIR / EQUIPMENT FLAGS

| Field | Location | Type | Notes |
|-------|----------|------|--------|
| `is_wheelchair` | `trips` | `boolean NOT NULL` | Trip-level; can differ from client default |
| `is_wheelchair` | `clients` | `boolean NOT NULL` | Default for client; `20260325100000` |

**No** columns found for stretcher, oxygen, companion, bariatric, or other equipment in migrations or `database.types.ts` for `trips` / `clients`.

---

## 6. PATIENT / PASSENGER FIELDS

### Model

- **No** `patients` or `customers` table.
- Passengers are **`clients`** (Fahrgast), optionally linked per trip via `trips.client_id`.
- Trip also stores denormalized `client_name`, `client_phone` for display and invoicing snapshots.

### `public.clients` (reporting-relevant)

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `uuid` | NO |
| `company_id` | `uuid` | NO |
| `customer_number` | `integer` | NO | Per-company unique |
| `first_name`, `last_name` | `text` | YES |
| `company_name` | `text` | YES | When `is_company` |
| `is_company` | `boolean` | NO |
| `street`, `street_number`, `zip_code`, `city` | `text` | NO (address required on client) |
| `phone`, `phone_secondary`, `email` | `text` | YES |
| `greeting_style` | `text` | YES |
| `is_wheelchair` | `boolean` | NO |
| `price_tag` | `numeric` | YES | Default gross price for trips |
| `reference_fields` | `jsonb` | YES | Ordered `{ label, value }[]` (e.g. Versichertennummer) — invoice PDF only via snapshot |
| `relation` | `text` | YES |
| `stations` | `text[]` | YES |
| `requires_daily_scheduling` | `boolean` | YES |
| `notes` | `text` | YES |
| `lat`, `lng` | `double precision` | YES |

**Not present** on `clients` or `trips`: date of birth, age, diagnosis, ICD, insurance number as first-class columns (insurance IDs may appear only inside `clients.reference_fields` JSON).

---

## 7. DATE AND TIME FIELDS

| Field | Purpose |
|-------|---------|
| `scheduled_at` | Primary scheduled departure (timestamptz, nullable) |
| `requested_date` | Calendar business date; used when time is unknown / date-only trips |
| `actual_pickup_at` / `actual_dropoff_at` | Actual times (nullable; driver workflow) |
| `created_at` | Record creation |

**Filtering:** Day boundaries must use `getZonedDayBoundsIso` / `Europe/Berlin` (`docs/trips-date-filter.md`, `AGENTS.md`). Do not filter `scheduled_at` with naive local `Date` constructors.

**No** separate `trip_date` or `pickup_time` columns on `trips` (recurring rules use `pickup_time` on `recurring_rules`, not trips).

---

## 8. STATUS AND WORKFLOW FIELDS

### Trip `status`

- Column: `text NOT NULL`, **no CHECK** in repo migrations.
- Canonical app values (`src/lib/trip-status.ts`, kept in sync with DB comment):

| Value | Meaning (admin) |
|-------|-----------------|
| `pending` | Offen — no driver |
| `open` | Legacy alias for `pending` |
| `assigned` | Driver assigned (admin) |
| `scheduled` | Geplant (driver portal) |
| `in_progress` | Unterwegs |
| `driving` | Legacy alias for `in_progress` |
| `completed` | Abgeschlossen |
| `cancelled` | Storniert |

Driver portal also defines `no_show` in `TRIP_STATUSES` (`src/features/driver-portal/types/trips.types.ts`) — **not** listed in admin `TripStatus`; confirm production data if reporting includes driver-only statuses.

### Cancellation

- No `cancelled` boolean; use `status = 'cancelled'`.
- `canceled_reason_notes`, `notes` store cancellation context.

### Invoicing status (derived, not on `trips`)

Effective per-trip status from joined `invoice_line_items` / `invoices`:

| Effective status | Rule (simplified) |
|------------------|-------------------|
| `paid` | Any linked invoice `paid` |
| `sent` | Else any `sent` |
| `draft` | Else any `draft` (incl. open Storno) |
| `uninvoiced` | No qualifying line items |

RPC: `trip_ids_matching_invoice_effective_status(p_effective)` (`20260411140000`). Invoice row statuses: `draft`, `sent`, `paid`, `cancelled`, `corrected`.

---

## 9. DRIVER / VEHICLE FIELDS

### Driver

- `trips.driver_id` → `accounts.id` where `accounts.role` is `admin` or `driver` (drivers use `role = 'driver'`).
- **No** separate `drivers` table; extended data in `driver_profiles` (`license_number`, address, `default_vehicle_id`, etc.).
- Secondary assignment: `trip_assignments` (`trip_id`, `driver_id`, `status`, `assigned_at`) for multi-driver / RLS.

### Vehicle

- `trips.vehicle_id` → `vehicles.id`
- `vehicles`: `name`, `license_plate`, `color`, `status`, `is_active`, `company_id`

### Shifts (related, not on trip row)

`shifts` / `shift_events` / `shift_reconciliations` track driver shifts; `get_shift_day_summaries` aggregates trips per driver per Berlin calendar day for Schichtzettel (self-pay vs invoice counts).

---

## 10. EXISTING REPORTING OR AGGREGATION

| Capability | Location | What it aggregates |
|------------|----------|-------------------|
| Dashboard revenue | `src/features/dashboard/lib/stats-utils.ts` | Sum of `trip.net_price` per day |
| Overview layout | `src/app/dashboard/overview/layout.tsx` | Today vs yesterday revenue via `calculateTotalRevenue` |
| Occupancy chart | `src/features/dashboard/lib/occupancy-utils.ts` | Trip counts / buckets |
| Trip distance metrics API | `GET /api/trips/metrics` | Min/max/avg `driving_distance_km` (session auth) |
| Group metrics API | `GET /api/trips/groups/metrics` | Group-level metrics |
| Shift day summaries RPC | `get_shift_day_summaries` | Per driver/day: trip count, self-pay count/total, invoice count, unconfigured billing |
| CSV export | `POST /api/trips/export` | Filterable export (payer, billing type, date range, column picker); admin + service role |
| Print / ZIP | `docs/print-trips-export.md` | Per-driver PDFs + JPEG board overviews |
| Invoice PDFs | `src/features/invoices/components/invoice-pdf/*` | Aggregated line items, km totals, VAT buckets |
| Abrechnung overview | `src/features/invoices/components/abrechnung-overview/*` | Recent invoices, not trip analytics |
| Price backfill audit | `trip_price_backfill_audit` table | Temporary pricing reconciliation (`20260513220000`) |

**No** dedicated `/dashboard/reports` page or payer-facing report UI exists in the codebase.

---

## 11. RLS AND PAYER ACCESS

### Trips RLS (`20260409170000`, fixes in `20260409180000`, `20260409190000`)

| Role | Policy | Scope |
|------|--------|--------|
| Admin | `trips_*_company_admin` | Full CRUD where `company_id = current_user_company_id()` |
| Driver | `trips_select_own_driver`, `trips_update_own_driver` | `driver_id = auth.uid()` OR row in `trip_assignments` |

**No** policy filters `trips` by `payer_id`. Drivers never receive payer-scoped company-wide data through RLS.

### Payer / client data

- `payers`, `clients`, `invoices`, `billing_*`: **admin-only**, company-scoped (`docs/access-control.md`).

### Payer identity in auth

- Auth is **Clerk** + Supabase `accounts` row (`id` = `auth.uid()`, `company_id`, `role`).
- Roles: `admin` (dashboard) and `driver` (`/driver/*`) only.
- **No** Kostenträger login, payer JWT claim, or payer API key pattern exists in this repo.

**Implication for per-payer reporting:** Requires **new** auth surface (e.g. payer portal user linked to `payers.id`) and **new** RLS policies (e.g. `payer_id = current_payer_id()`), plus application-layer guards. Cannot be done with current schema policies alone.

---

## 12. MISSING OR INCOMPLETE DATA (engineering assessment)

### Likely gaps for billing / transport reporting

| Gap | Detail |
|-----|--------|
| Authorization / approval number | No trip or client column |
| Diagnosis / transport indication | Not modeled |
| Insurance number | Only via unstructured `clients.reference_fields` |
| Age / DOB | Not on `clients` |
| Price per km on trip | Only inside `billing_pricing_rules.config`; not denormalized |
| Base fare / fixed tariff on trip | Only via price resolution snapshot on **invoice line items** after invoicing |
| Paid amount on trip | Payment tracked at **invoice** level (`paid_at`), not trip |
| Cash collected | `selbstzahler_collected_amount` exists but documented as without UI |
| Actual vs scheduled duration | `actual_*` timestamps exist but population depends on driver usage |
| Equipment beyond wheelchair | Not modeled |

### Fields that exist but are often incomplete or inconsistent

| Area | Issue |
|------|--------|
| `driving_distance_km` / `driving_duration_seconds` | NULL when geocoding/routing fails (`has_missing_geodata`) |
| `scheduled_at` | NULL for date-only / bulk imports; use `requested_date` for date reports |
| `base_net_price` / `approach_fee_net` | Nullable until backfill or price engine runs; `net_price` shows `0` when both null (generated COALESCE) |
| `billing_variant_id` / `payer_id` | Nullable on legacy rows; create flows require variant when catalog exists |
| `billing_type_id` | May be out of sync if variant changes without backfill |
| `client_id` | Nullable; `client_name` may exist without FK |
| `return_status` | Exported; no documented enum or active UI setter found |
| `payment_method` | On trips and legacy `rides` table; unclear population on trips |
| `note` vs `notes` | Duplicate note channels |
| Status values | `open`/`driving` legacy aliases; possible `no_show` in driver data but not in admin helper |
| TypeScript types | `database.types.ts` missing `invoices`, `invoice_line_items`, payer address columns; several `TODO: regenerate` comments |

### Stale documentation

`docs/billing-families-variants.md` states legacy `trips.billing_type_id` was removed; migration `20260418120000` **re-added** it. Reporting design should treat **both** `billing_variant_id` (leaf) and `billing_type_id` (denormalized family) as present.

---

## Reporting Readiness Summary

| Dimension | Status | Notes |
|-----------|--------|--------|
| **Payer** | ⚠️ | `payer_id` + rich `payers` row; nullable on some trips; **no payer auth/RLS** for client-facing reports |
| **billing_type** (family) | ⚠️ | FK `billing_type_id` + join via variant; dynamic names per payer, not enum |
| **billing_variant** | ⚠️ | FK `billing_variant_id`; required on new trips; legacy NULLs possible |
| **reha_schein** | ✅ | `boolean NOT NULL` on trip; gated by `payers.reha_schein_enabled` |
| **kts** (`kts_document_applies`) | ✅ | `boolean NOT NULL` + `kts_source`; well documented |
| **kts_fehler** | ✅ | Boolean + optional description |
| **wheelchair** | ✅ | `trips.is_wheelchair` NOT NULL; also on `clients` |
| **distance** | ⚠️ | `driving_distance_km` + `manual_distance_km`; often NULL without route |
| **duration** | ⚠️ | `driving_duration_seconds` only; nullable; convert to minutes in reports |
| **driver** | ⚠️ | `driver_id` nullable; use `accounts` + `driver_profiles`; `trip_assignments` for edge cases |
| **vehicle** | ⚠️ | `vehicle_id` nullable |
| **date range** | ⚠️ | `scheduled_at` + `requested_date`; timezone rules mandatory; NULL scheduled times |
| **price / revenue** | ⚠️ | `net_price` generated; unpriced trips appear as 0; full audit trail on invoices/line items |
| **invoice status** | ⚠️ | Derived via joins; not on trip row |
| **passenger identity** | ⚠️ | `clients` + denormalized name; no DOB/insurance columns |
| **company scope** | ✅ | `company_id` on trips; admin RLS by company |
| **per-payer external access** | ❌ | No payer role, portal, or RLS |

**Legend:** ✅ data exists and is structurally fit for reporting · ⚠️ exists but incomplete, derived, or needs business rules · ❌ missing for stated goal

---

## Related tables (quick reference)

| Table | Reporting use |
|-------|----------------|
| `invoice_line_items` | Frozen trip snapshots, pricing, km, KTS override, `trip_meta_snapshot` |
| `invoices` | Period, payer, totals, status, `billing_type_id` / `billing_variant_id` scope |
| `billing_pricing_rules` | Rule definitions (not trip history) |
| `client_price_tags` / `client_km_overrides` | Client-level pricing overrides |
| `recurring_rules` | Template for generated trips (billing + KTS + reha flags) |
| `fremdfirmen` | External operator catalog |
| `route_metrics_cache` | Cached route metrics (not per-trip) |
| `rides` | Legacy/separate ride log — **not** the main admin trip model |

---

## Migrations reviewed

All files under `supabase/migrations/` (91 files, sorted chronologically from `05-kundennummer-system.sql` through `20260514160000_trip_presets_column_order.sql`). Every migration touching `trips`, `payers`, `clients`, `billing_*`, `invoices`, `invoice_line_items`, RLS, or pricing was read or grep-verified; base `CREATE TABLE trips` predates this repository.
