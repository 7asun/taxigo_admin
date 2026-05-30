# CFO Dashboard — Schema & Data Model Audit

**Date:** 2026-05-30  
**Scope:** Read-only audit to inform a CFO-grade analytics dashboard. No code or schema changes.  
**Sources:** All 101 files in `supabase/migrations/`, `src/types/database.types.ts`, `src/features/invoices/types/invoice.types.ts`, trip/driver/payer/dashboard modules, `docs/` (especially `reporting-audit.md`, `timezone-master-audit.md`, `abrechnung-overview.md`, `trips-date-filter.md`), and **live Supabase introspection** (project `etwluibddvljuhkxjkxs`, queried 2026-05-30).

**Critical limitation:** The repository does **not** contain the initial `CREATE TABLE public.trips` (or baseline `accounts`, `payers`, `clients`) DDL. The column inventory below is the **effective production schema** from `information_schema.columns`, cross-checked against migrations and TypeScript types. Where repo types lag production, both are noted.

---

## Executive summary

TaxiGo stores operational and billing data in a multi-tenant Postgres schema centered on **`trips`**. There is **no separate `drivers` table** — drivers are `accounts` rows with `role = 'driver'`, extended by `driver_profiles`. Revenue exists at two layers:

1. **Trip-level (operational):** `net_price` (generated), `gross_price`, `tax_rate`, split components — used by the current dashboard “Umsatz heute”.
2. **Invoice-level (legal/finance):** `invoices.subtotal`, `tax_amount`, `total` — immutable snapshots when invoices are finalized.

The existing overview dashboard computes “Umsatz heute” **client-side** over **all trips** fetched via PostgREST, using **browser-local calendar days** (not `Europe/Berlin`), summing **`net_price`** and excluding `cancelled` trips only. This is **not CFO-grade** without redesign: timezone mismatch, no cash vs accrual distinction, unpriced trips appear as €0, and ~64% of production trips lack `billing_variant_id`.

Production snapshot (single tenant today): **2,597 trips**, date range **2026-02-25 → 2026-07-23**, **14 invoices**, **10 payers**, **7 drivers**.

---

## 1. TRIPS TABLE — Full schema

### 1.1 Column inventory (production PostgreSQL)

| Column | PostgreSQL type | Nullable | Notes |
|--------|-----------------|----------|-------|
| `id` | `uuid` | **NOT NULL** | PK, default `gen_random_uuid()` |
| `company_id` | `uuid` | YES | FK → `companies.id` |
| `created_by` | `uuid` | YES | FK → `accounts.id` |
| `driver_id` | `uuid` | YES | FK → `accounts.id` (driver role) |
| `vehicle_id` | `uuid` | YES | FK → `vehicles.id` |
| `shift_id` | `uuid` | YES | FK → `shifts.id` — **in production DB, absent from `database.types.ts`** |
| `client_id` | `uuid` | YES | FK → `clients.id` |
| `client_name` | `text` | YES | Denormalized passenger label |
| `client_phone` | `text` | YES | Denormalized |
| `payer_id` | `uuid` | YES | FK → `payers.id` |
| `billing_variant_id` | `uuid` | YES | FK → `billing_variants.id` (leaf billing selection) |
| `billing_type_id` | `uuid` | YES | FK → `billing_types.id` (denormalized family) |
| `billing_calling_station` | `text` | YES | Billing metadata |
| `billing_betreuer` | `text` | YES | Billing metadata |
| `scheduled_at` | **`timestamptz`** | YES | Primary scheduled departure instant |
| `requested_date` | **`date`** | YES | Calendar day when time unknown / date-only |
| `actual_pickup_at` | `timestamptz` | YES | Driver-recorded pickup |
| `actual_dropoff_at` | `timestamptz` | YES | Driver-recorded dropoff |
| `created_at` | `timestamptz` | YES | Default `now()` |
| `status` | `text` | **NOT NULL** | No PostgreSQL CHECK in repo; app-enforced values (§1.3) |
| `pickup_address` | `text` | YES | |
| `pickup_street` | `text` | YES | |
| `pickup_street_number` | `text` | YES | |
| `pickup_zip_code` | `text` | YES | |
| `pickup_city` | `text` | YES | |
| `pickup_station` | `text` | YES | Passenger-facing station label |
| `pickup_lat` / `pickup_lng` | `numeric` | YES | Production uses `numeric`; migrations mention `double precision` |
| `pickup_place_id` | `text` | YES | Google Places ID (form-created trips) |
| `pickup_location` | `jsonb` | YES | Legacy geo blob |
| `dropoff_address` | `text` | YES | |
| `dropoff_street` | `text` | YES | |
| `dropoff_street_number` | `text` | YES | |
| `dropoff_zip_code` | `text` | YES | |
| `dropoff_city` | `text` | YES | |
| `dropoff_station` | `text` | YES | |
| `dropoff_lat` / `dropoff_lng` | `numeric` | YES | |
| `dropoff_place_id` | `text` | YES | |
| `dropoff_location` | `jsonb` | YES | |
| `additional_pickups` | `jsonb` | YES | **Production only; not in `database.types.ts`** |
| `additional_dropoffs` | `jsonb` | YES | **Production only; not in `database.types.ts`** |
| `driving_distance_km` | **`double precision`** | YES | Route distance (Google Directions proxy) |
| `driving_duration_seconds` | **`integer`** | YES | Route duration in **seconds** (not minutes) |
| `manual_distance_km` | `double precision` | YES | Admin km override for pricing |
| `base_net_price` | `numeric` | YES | Transport net (excl. Anfahrt) |
| `approach_fee_net` | `numeric` | YES | Approach fee net |
| `net_price` | `numeric` | YES* | **GENERATED STORED** — see §1.2 |
| `gross_price` | `numeric` | YES | Stored gross when computed |
| `tax_rate` | `numeric` | YES | e.g. `0.07`, `0.19` — **not** a tax amount column |
| `manual_gross_price` | `numeric` | YES | Taxameter / admin gross override |
| `selbstzahler_collected_amount` | `numeric` | YES | Cash collected (placeholder; no UI in V1) |
| `payment_method` | `text` | YES | No CHECK in repo |
| `is_wheelchair` | `boolean` | **NOT NULL** | Default `false` |
| `kts_document_applies` | `boolean` | **NOT NULL** | Default `false` |
| `kts_source` | `text` | YES | `variant`, `familie`, `payer`, `manual`, `system_default` |
| `kts_fehler` | `boolean` | **NOT NULL** | Default `false` |
| `kts_fehler_beschreibung` | `text` | YES | |
| `reha_schein` | `boolean` | **NOT NULL** | Default `false` |
| `no_invoice_required` | `boolean` | **NOT NULL** | Default `false` |
| `no_invoice_source` | `varchar(20)` | YES | Cascade source for no-invoice flag |
| `fremdfirma_id` | `uuid` | YES | FK → `fremdfirmen.id` |
| `fremdfirma_payment_mode` | `text` | YES | CHECK when set: `cash_per_trip`, `monthly_invoice`, `self_payer`, `kts_to_fremdfirma` |
| `fremdfirma_cost` | `numeric` | YES | External operator cost |
| `greeting_style` | `text` | YES | |
| `has_missing_geodata` | `boolean` | **NOT NULL** | Default `false` |
| `needs_driver_assignment` | `boolean` | **NOT NULL** | Default `false` |
| `ingestion_source` | `text` | YES | e.g. `csv_bulk_upload`, `manual_form` |
| `group_id` | **`text`** | YES | Kanban grouping — **types say `uuid`; production is `text`** |
| `stop_order` | `integer` | YES | Order within group |
| `stop_updates` | `jsonb` | **NOT NULL** | Default `'[]'::jsonb` in production |
| `linked_trip_id` | `uuid` | YES | FK → `trips.id` (Hin/Rück pairs) |
| `link_type` | `text` | YES | App: `outbound`, `return` |
| `return_status` | `text` | YES | No documented enum |
| `rule_id` | `uuid` | YES | FK → `recurring_rules.id` |
| `note` | `text` | YES | |
| `notes` | `text` | YES | Cancellation / driver notes |
| `canceled_reason_notes` | `text` | YES | |

\* `net_price` is a generated column; `information_schema` reports `is_nullable = YES` but the expression always yields a numeric value.

### 1.2 Price columns — answers to specific questions

| Question | Answer |
|----------|--------|
| **`gross_price` storage** | **`numeric`** (Euro decimal, **not** integer cents). Same for `base_net_price`, `approach_fee_net`, `net_price`, `manual_gross_price`. Invoice totals use `numeric(10,2)` in migration DDL. |
| **`net_price`** | **Yes.** Since migration `20260425120000`, it is **GENERATED ALWAYS AS (COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)) STORED**. Read-only in application code. |
| **`tax_amount` on trips** | **No.** Tax is implied via `gross_price` and `tax_rate`, or computed at invoice line level. **`invoices.tax_amount`** holds aggregated MwSt. |
| **`commission`** | **No column** on trips or invoices. |
| **`status`** | **Yes** — `text NOT NULL`. Values in §1.3. |
| **Timestamp columns** | `created_at`, `scheduled_at`, `actual_pickup_at`, `actual_dropoff_at`. There is **no** `started_at`, `ended_at`, or `completed_at` column — completion is modeled via `status = 'completed'` and optionally `actual_dropoff_at`. |
| **`distance_driving_km`** | Column name is **`driving_distance_km`**, type **`double precision`** (float), nullable. |
| **Duration** | **`driving_duration_seconds`** (`integer`), nullable. **No** `duration_minutes` column — divide by 60 in analytics SQL. |
| **`vehicle_type` / `car_category`** | **No.** Only `vehicle_id` → `vehicles` (`name`, `license_plate`, `color`, `status`, `is_active`). Wheelchair is `is_wheelchair` on trip/client, not a vehicle category. |

### 1.3 Enum types and status values

**PostgreSQL enums on `trips`:** **None.** `billing_type` and `billing_variant` are **FK references to catalog tables** (`billing_types`, `billing_variants`), not enum columns. Names and codes are **per-tenant, per-payer** (see `docs/billing-families-variants.md`).

**Trip `status`** — `text`, no DB CHECK in repo migrations. Canonical app values (`src/lib/trip-status.ts`):

| Value | Admin label | Meaning |
|-------|-------------|---------|
| `pending` | Offen | No driver assigned |
| `open` | Offen | Legacy alias for `pending` |
| `assigned` | Zugewiesen | Driver assigned (admin flow) |
| `scheduled` | Geplant | Planned (driver portal) |
| `in_progress` | Unterwegs | Trip underway |
| `driving` | Unterwegs | Legacy alias for `in_progress` |
| `completed` | Erledigt | Trip finished |
| `cancelled` | Storniert | Cancelled |

Driver portal may also use `no_show` (`src/features/driver-portal/types/trips.types.ts`) — not in admin `TripStatus`; verify before reporting.

**Production status distribution (2026-05-30):**

| status | count |
|--------|------:|
| `assigned` | 2,296 |
| `pending` | 181 |
| `cancelled` | 115 |
| `completed` | 4 |
| `in_progress` | 1 |

**Invoice `status`** — `text NOT NULL` with CHECK: `draft`, `sent`, `paid`, `cancelled`, `corrected`.

**Angebot `status`** — PostgreSQL enum `angebot_status`: `draft`, `sent`, `accepted`, `declined`.

**Pricing basis** — enum `pricing_basis_enum`: `net`, `gross` (on `billing_pricing_rules`, not trips).

---

## 2. RELATED TABLES — Full schema

### 2.1 Drivers — there is no `drivers` table

Drivers are modeled as:

#### `public.accounts` (identity + role)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | `uuid` | NOT NULL | Same as `auth.uid()` |
| `company_id` | `uuid` | YES | Tenant scope |
| `role` | `text` | NOT NULL | `admin` or `driver` |
| `name` | `text` | NOT NULL | Display name |
| `first_name` | `text` | YES | |
| `last_name` | `text` | YES | |
| `email` | `text` | YES | |
| `phone` | `text` | YES | |
| `is_active` | `boolean` | YES | Active/inactive flag |
| `created_at` | `timestamptz` | YES | |

**Production:** 7 accounts with `role = 'driver'`.

#### `public.driver_profiles` (extended driver data)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | `uuid` | NOT NULL | |
| `user_id` | `uuid` | YES | FK → `accounts.id` |
| `license_number` | `text` | YES | |
| `default_vehicle_id` | `uuid` | YES | FK → `vehicles.id` |
| `street`, `street_number`, `zip_code`, `city` | `text` | YES | Home address |
| `lat`, `lng` | `double precision` | YES | |
| `notes` | `text` | YES | |
| `created_at` | `timestamptz` | YES | |

**Trip assignment:** `trips.driver_id` → `accounts.id`. Secondary: `trip_assignments` (`trip_id`, `driver_id`, `status`, `assigned_at`).

**Related (not on trip row):** `shifts`, `shift_events`, `shift_reconciliations`, `driver_day_plans`.

### 2.2 `public.payers` (Kostenträger)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | `uuid` | NOT NULL | |
| `company_id` | `uuid` | NOT NULL | |
| `name` | `text` | NOT NULL | Company/institution name on invoices |
| `number` | **`integer`** | NOT NULL | Internal reference — **types say `string`; production is `integer`** |
| `created_at` | `timestamptz` | NOT NULL | |
| `street`, `street_number`, `zip_code`, `city` | `text` | YES | Invoice address (§14 UStG) |
| `contact_person` | `text` | YES | |
| `email`, `phone` | `text` | YES | |
| `kts_default` | `boolean` | YES | Tri-state KTS default |
| `no_invoice_required_default` | `boolean` | YES | |
| `rechnungsempfaenger_id` | `uuid` | YES | FK → `rechnungsempfaenger` |
| `accepts_self_payment` | `boolean` | YES | Selbstzahler default |
| `manual_km_enabled` | `boolean` | NOT NULL | Default false |
| `reha_schein_enabled` | `boolean` | NOT NULL | Default false |
| `revision_invoices_enabled` | `boolean` | NOT NULL | |
| `default_intro_block_id`, `default_outro_block_id` | `uuid` | YES | Invoice text blocks |
| `pdf_vorlage_id` | `uuid` | YES | PDF template |

**There is no payer “type” enum.** Classification is via linked **`billing_types`** (families) and **`billing_variants`** (Unterarten) under each payer.

**Production:** 10 payers; **0%** of trips have `payer_id` NULL.

### 2.3 `public.vehicles`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | `uuid` | NOT NULL | |
| `company_id` | `uuid` | YES | |
| `name` | `text` | NOT NULL | |
| `license_plate` | `text` | NOT NULL | |
| `color` | `text` | YES | |
| `status` | `text` | YES | No CHECK in repo |
| `is_active` | `boolean` | YES | |
| `created_at` | `timestamptz` | YES | |

**Production:** **0%** of trips have `vehicle_id` populated — vehicle analytics not viable today.

### 2.4 `public.invoices`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | `uuid` | NOT NULL | |
| `company_id` | `uuid` | NOT NULL | |
| `invoice_number` | `text` | NOT NULL | UNIQUE, format RE-YYYY-NNNN |
| `payer_id` | `uuid` | NOT NULL | |
| `billing_type_id` | `uuid` | YES | Scope filter |
| `billing_variant_id` | `uuid` | YES | Unterart scope |
| `mode` | `text` | NOT NULL | CHECK: `monthly`, `single_trip`, `per_client` |
| `client_id` | `uuid` | YES | Required for `per_client` |
| `period_from`, `period_to` | `date` | NOT NULL | Service period |
| `status` | `text` | NOT NULL | See §1.3 |
| `subtotal` | `numeric(10,2)` | NOT NULL | Net snapshot |
| `tax_amount` | `numeric(10,2)` | NOT NULL | MwSt snapshot |
| `total` | `numeric(10,2)` | NOT NULL | Gross snapshot |
| `notes` | `text` | YES | |
| `payment_due_days` | `integer` | NOT NULL | Default 14 |
| `created_by` | `text` | YES | |
| `created_at` | `timestamptz` | NOT NULL | |
| `updated_at`, `sent_at`, `paid_at`, `cancelled_at` | `timestamptz` | YES | Lifecycle |
| `cancels_invoice_id` | `uuid` | YES | Storno chain |
| `rechnungsempfaenger_id` | `uuid` | YES | |
| `rechnungsempfaenger_snapshot` | `jsonb` | YES | Frozen recipient |
| `client_reference_fields_snapshot` | `jsonb` | YES | |
| `pdf_column_override` | `jsonb` | YES | |
| `intro_block_id`, `outro_block_id` | `uuid` | YES | |
| `email_subject`, `email_body` | `text` | YES | |

**Line items:** `invoice_line_items` — frozen trip snapshots (price, km, addresses, KTS, `trip_meta_snapshot`). **Never join back to `trips` for issued invoice display.**

**Production:** 14 invoices total.

### 2.5 `public.angebote` (offers — not linked to trips)

Offers are **prospective quotes**, not executed trips. **No FK from `angebote` to `trips`.**

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `uuid` | NOT NULL |
| `company_id` | `uuid` | NOT NULL |
| `angebot_number` | `text` | NOT NULL UNIQUE |
| `status` | `angebot_status` enum | NOT NULL |
| Recipient fields | `text` | YES (free-text, no payer FK) |
| `offer_date` | `date` | NOT NULL |
| `valid_until` | `date` | YES |
| `subject`, `intro_text`, `outro_text` | `text` | YES |
| `pdf_column_override`, `table_schema_snapshot` | `jsonb` | YES |
| `show_totals_block` | `boolean` | NOT NULL |
| `input_mode` | `text` | NOT NULL |
| `default_tax_rate` | `numeric` | YES |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

**Production:** 5 angebote.

### 2.6 Foreign keys on `trips` (production)

| Column | → Table |
|--------|---------|
| `company_id` | `companies` |
| `created_by`, `driver_id` | `accounts` |
| `vehicle_id` | `vehicles` |
| `shift_id` | `shifts` |
| `client_id` | `clients` |
| `payer_id` | `payers` |
| `billing_type_id` | `billing_types` |
| `billing_variant_id` | `billing_variants` |
| `fremdfirma_id` | `fremdfirmen` |
| `linked_trip_id` | `trips` |
| `rule_id` | `recurring_rules` |

---

## 3. EXISTING DATA PATTERNS

### 3.1 How “Umsatz heute” (today revenue) is calculated today

**UI:** `src/app/dashboard/overview/layout.tsx`  
**Data hook:** `useTrips()` → `tripsService.getTrips()`  
**Math:** `src/features/dashboard/lib/stats-utils.ts`

#### Step 1 — Fetch all trips (PostgREST)

```typescript
// src/features/trips/api/trips.service.ts
const { data, error } = await supabase
  .from('trips')
  .select('*')
  .order('scheduled_at', { ascending: false });
```

RLS scopes to the authenticated admin’s `company_id`. **No date filter at query time** — every trip row is loaded into the browser.

#### Step 2 — Filter to “today” (client-side)

```typescript
// src/features/dashboard/lib/stats-utils.ts
export function getTripsForDay(trips: Trip[], date: Date): Trip[] {
  return trips.filter((trip) => {
    if (!trip.scheduled_at) return false;
    if (trip.status === 'cancelled') return false;
    return isSameDay(parseISO(trip.scheduled_at), date);
  });
}
```

**Important:** `isSameDay` from `date-fns` uses the **browser’s local timezone**, **not** `Europe/Berlin`. This diverges from the rest of the trips module, which mandates `getZonedDayBoundsIso` / `getTripsBusinessTimeZone()` (`docs/trips-date-filter.md`, `AGENTS.md`).

#### Step 3 — Sum net revenue

```typescript
export function calculateTotalRevenue(trips: Trip[]): number {
  return trips.reduce((total, trip) => {
    if (trip.status === 'cancelled') return total;
    return total + (trip.net_price || 0);
  }, 0);
}
```

**Included:** Non-cancelled trips whose `scheduled_at` falls on “today” (browser TZ).  
**Excluded:** Trips with `scheduled_at` NULL (even if `requested_date` is today).  
**Metric:** Sum of **`net_price`** (generated net = base + approach fee), **not** gross, **not** invoiced revenue.  
**Not excluded:** `pending`, `assigned`, `cancelled`-adjacent future trips — only explicit `cancelled` status in the day filter.

#### Equivalent SQL a CFO dashboard should **not** copy blindly

```sql
-- Approximates current app logic ONLY if session TZ = browser TZ
-- and ignores requested_date-only trips
SELECT COALESCE(SUM(net_price), 0)
FROM public.trips t
WHERE t.status <> 'cancelled'
  AND t.scheduled_at IS NOT NULL
  AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date = CURRENT_DATE;  -- Berlin-correct variant
```

#### “Rechnungsumsatz” card (second revenue KPI)

```typescript
// src/features/invoices/api/invoices.api.ts
const { data } = await supabase
  .from('invoices')
  .select('total')
  .in('status', ['sent', 'paid']);

return (data ?? []).reduce((sum, row) => sum + (Number(row.total) || 0), 0);
```

- Sums **gross** invoice `total` (Brutto), not net.
- **All-time** — no date filter, no period alignment with trips.
- RLS scopes to company (comment in code); relies on invoice RLS policies.
- **Not** cash-basis (`paid_at`) — includes all sent + paid invoices ever.

### 3.2 Other aggregation in Supabase / codebase

| Capability | Location | Aggregation |
|------------|----------|-------------|
| Shift day summaries | RPC `get_shift_day_summaries(driver_id, company_id)` | Per Berlin calendar day: trip count, self-pay count/total (gross), invoice-billed count; **`status = 'assigned'` only** |
| Trip IDs by invoice status | RPC `trip_ids_matching_invoice_effective_status` | Filter trips by derived invoice state |
| Dashboard occupancy | `occupancy-utils.ts` | Hourly/weekly trip counts + `net_price` sums — **browser local TZ** |
| Trip metrics API | `GET /api/trips/metrics` | min/max/avg `driving_distance_km` |
| CSV export | `POST /api/trips/export` | Filterable export (admin) |
| Abrechnung KPIs | `useAbrechnungKpis` | Client-side over all invoices — open, overdue, this month (`sent_at`) |
| Invoice PDFs | invoice builder | VAT buckets, km totals from line item snapshots |

**PostgreSQL views:** **None** in `public` schema (verified 2026-05-30).

### 3.3 RLS policies on `trips` (analytics impact)

From migrations `20260409170000`, `20260409180000`, `20260409190000`:

| Role | Access |
|------|--------|
| **Admin** | Full CRUD where `company_id = current_user_company_id()` |
| **Driver** | SELECT where `driver_id = auth.uid()` OR row in `trip_assignments`; UPDATE own rows |

**Analytics implication:** Admin CFO dashboards can aggregate all company trips via authenticated Supabase client or server routes with admin context. **No payer-scoped RLS** exists — payer breakdowns are safe for admins only. Drivers cannot run company-wide analytics through RLS. **Service-role** bypasses RLS (cron/export only — not for user-facing CFO UI without careful guards).

`invoices`, `payers`, `clients`: **admin-only**, company-scoped.

### 3.4 Production data volume & date range (2026-05-30)

| Metric | Value |
|--------|------:|
| Total trips | 2,597 |
| Companies with trips | 1 |
| `scheduled_at` range | 2026-02-25 → 2026-07-23 (UTC instants) |
| `requested_date` range | 2026-02-25 → 2026-07-23 |
| Payers | 10 |
| Drivers (`role = driver`) | 7 |
| Invoices | 14 |
| Angebote | 5 |

#### NULL / data-quality rates (trips)

| Field | NULL or zero rate | Notes |
|-------|------------------:|-------|
| `scheduled_at` NULL | 80 (3.1%) | Excluded from “Umsatz heute” |
| `driver_id` NULL | 276 (10.6%) | |
| `billing_variant_id` NULL | **1,648 (63.5%)** | Major reporting gap for variant breakdown |
| `driving_distance_km` NULL | 16 (0.6%) | Good coverage |
| `driving_duration_seconds` NULL | 17 (0.7%) | |
| Both price components NULL | 151 (5.8%) | `net_price` shows **0** via COALESCE |
| `net_price = 0` | 496 (19.1%) | Includes unpriced + zero-KTS |
| `cancelled` | 115 (4.4%) | |
| `actual_pickup_at` populated | **5 (0.2%)** | Actuals not usable for analytics |
| `vehicle_id` populated | **0 (0%)** | |
| `client_id` populated | 1,527 (58.8%) | |
| `gross_price` populated | 2,480 (95.5%) | |

---

## 4. TIMESTAMP & DATE COVERAGE

### 4.1 Which column is the “trip date” for time-series?

| Use case | Recommended column | Rule |
|----------|-------------------|------|
| **Scheduled operational date** | `scheduled_at` | Convert to Berlin calendar day: `(scheduled_at AT TIME ZONE 'Europe/Berlin')::date` — same pattern as `get_shift_day_summaries` |
| **Date-only / unscheduled legs** | `requested_date` | Use when `scheduled_at IS NULL` (80 rows today) |
| **Invoice / service period** | `invoice_line_items.line_date` or `invoices.period_from/to` | Legal billing period — may differ from trip schedule |
| **Cash / payment recognition** | `invoices.paid_at` | No trip-level payment timestamp |
| **Record creation** | `created_at` | Ingestion audit, not service delivery |

**Do not** use raw UTC date truncation without `AT TIME ZONE 'Europe/Berlin'`.

### 4.2 Timezone handling

| Layer | Behavior |
|-------|----------|
| **Database storage** | `scheduled_at`, `actual_*`, `created_at` are **`timestamptz`** (absolute instants, stored UTC) |
| **Business calendar** | **`Europe/Berlin`** via JS helpers: `getZonedDayBoundsIso`, `instantToYmdInBusinessTz`, `todayYmdInBusinessTz` (`src/features/trips/lib/trip-business-date.ts`). Override: `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`. |
| **DB-level Berlin** | Used in RPC `get_shift_day_summaries`: `(scheduled_at AT TIME ZONE 'Europe/Berlin')::date` |
| **Dashboard “today”** | **Broken for CFO purposes:** uses browser-local `isSameDay`, not Berlin helpers |
| **Occupancy charts** | Same browser-local issue via `date-fns` `startOfDay` / `getHours` |

See `docs/plans/timezone-master-audit.md` for write-path and cron inconsistencies.

---

## 5. GAPS & RISKS

### 5.1 Data a CFO would want that is NOT in the DB

| Gap | Detail |
|-----|--------|
| **Commission / margin** | No commission column; `fremdfirma_cost` only for external operators |
| **Trip-level payment state** | Payment tracked on **invoices** (`paid_at`), not trips |
| **Cash collected** | `selbstzahler_collected_amount` exists but **no UI / population** |
| **Cost of goods / driver wage** | Shifts exist; no per-trip cost allocation |
| **Accounts receivable aging at trip level** | Only invoice-level open/overdue KPIs |
| **Budget vs actual** | No budget tables |
| **P&L categories** | Billing families are operational, not GL codes |
| **Equipment mix beyond wheelchair** | No stretcher/bariatric flags |
| **Patient demographics** | `clients.birthdate` added recently; sparse adoption unknown |
| **Offer → trip conversion** | Angebote not linked to trips |

### 5.2 Columns that exist but are inconsistently populated

| Area | Risk for analytics |
|------|-------------------|
| **`billing_variant_id` NULL (63.5%)** | Payer/variant revenue splits unreliable on historical data |
| **`net_price = 0` (19.1%)** | Inflates “zero revenue” days; mixes KTS €0, unpriced, and true free trips |
| **`scheduled_at` NULL (3.1%)** | Dropped from current dashboard; need `requested_date` coalesce |
| **`vehicle_id` (0%)** | Fleet utilization metrics impossible |
| **`actual_pickup_at` / `actual_dropoff_at` (<1%)** | SLA / on-time performance not measurable |
| **`status` stuck at `assigned` (88.4%)** | Trip lifecycle not reflected — revenue KPIs count assigned future trips as today’s revenue |
| **`group_id` type mismatch** | Types say UUID; DB is `text` — join/export bugs possible |
| **`database.types.ts` stale** | Missing `invoices`, `invoice_line_items`, payer address columns, `shift_id`, `additional_*` stops |
| **Accrual vs cash** | Trip net sum ≠ invoiced gross; dashboard shows both without reconciliation |

### 5.3 Indexes supporting aggregation

**Present (production):**

| Index | Columns | CFO use |
|-------|---------|---------|
| `idx_trips_company_scheduled_at` | `(company_id, scheduled_at DESC NULLS LAST)` | **Primary** time-series filter |
| `idx_trips_company_requested_date` | `(company_id, requested_date DESC NULLS LAST)` | Date-only trips |
| `idx_trips_company_driver_id` | `(company_id, driver_id)` | Driver breakdown |
| `idx_trips_company_payer_id` | `(company_id, payer_id)` | Payer breakdown |
| `idx_trips_company_status` | `(company_id, status)` | Status filters |
| `idx_trips_billing_type_id` | `(billing_type_id)` | Family filter |
| `trips_billing_variant_id_idx` | `(billing_variant_id)` | Variant filter |

**Missing for heavy analytics:** No covering index on `(company_id, (scheduled_at AT TIME ZONE 'Europe/Berlin')::date)` — expression index or materialized daily rollup table would help at scale. No pre-aggregated fact table.

---

## 6. SENIOR RECOMMENDATION — Top 3 risks for a reliable analytics page

### Risk 1 — Two incompatible revenue definitions with timezone bugs

The dashboard already shows **“Umsatz heute”** (trip **net**, browser-local day, all non-cancelled scheduled trips) beside **“Rechnungsumsatz”** (invoice **gross**, all-time sent+paid). A CFO will conflate these. Worse, **`getTripsForDay` does not use `Europe/Berlin`**, while invoices, Schichtzettel RPC, and trip list filters do. **Any CFO dashboard built on current `stats-utils` will disagree with Fahrten filters and legal invoice totals** — especially around midnight and for admins in non-German timezones.

**Mitigation:** Pick explicit metrics (e.g. “Geplanter Netto-Umsatz Berlin-Tag” vs “Fakturierter Brutto-Umsatz (Leistungszeitraum)” vs “Zahlungseingang (paid_at)”). Implement date bounds only via `getZonedDayBoundsIso` or SQL `AT TIME ZONE 'Europe/Berlin'`. Never use client-side full-table scans.

### Risk 2 — Trip price snapshots are operational, not audited financial truth

`net_price` is generated from nullable components; **19% of trips show €0** while **95% have gross_price**. Invoiced amounts live in **`invoice_line_items`** snapshots and may differ (billing inclusion rules, cancelled-trip opt-in, Storno chains, manual overrides). **Trip-level sums are unsuitable for statutory revenue reporting** without joining invoice line items and applying business rules from `docs/invoices-module.md` and `effective-trip-invoice-status`.

**Mitigation:** CFO views should primary-source **`invoice_line_items`** (net/gross/tax snapshots) for recognized revenue, with trips table for **volume/operations** KPIs (trips count, km, driver utilization). Document reconciliation variance explicitly.

### Risk 3 — Scale, completeness, and lifecycle blind spots

Current implementation loads **all trips** (`select('*')`) into the browser for stats. At 2,597 rows this works; at tens of thousands it will not. **`billing_variant_id` NULL on 63.5%** of rows breaks payer-product analytics. **`status = assigned` dominates** — counting revenue for “today” includes far-future scheduled trips that are not delivered. **`vehicle_id` and actual timestamps are empty** — fleet and SLA dashboards are not feasible without new capture workflows.

**Mitigation:** Add server-side aggregation (Supabase RPC or materialized daily rollup by `company_id`, Berlin date, payer_id, billing_variant_id, status bucket). Backfill `billing_variant_id` / price components where possible. Define CFO metrics on **completed or invoiced** trips, not merely scheduled+assigned.

---

## Appendix A — Existing dashboard pages

| Route | Purpose | Real data? |
|-------|---------|------------|
| `/dashboard` | Redirects to `/dashboard/overview` | — |
| `/dashboard/overview` | **Live KPIs:** Fahrten heute, Umsatz heute, Rechnungsumsatz; widgets for unplanned/timeless trips | **Partial** — parallel routes `@bar_stats`, `@area_stats`, etc. still serve **mock** shadcn demo charts (`src/features/overview/components/overview.tsx` is unused template) |
| `/dashboard/abrechnung` | Invoice KPIs (open, overdue, this month) | Real — client-side over invoices |
| `/dashboard/trips` | Operational trip list/kanban | Real |
| `/dashboard/invoices` | Invoice management | Real |

There is **no** dedicated CFO/analytics route. The “Analytics” tab in the legacy overview component is **disabled**.

---

## Appendix B — Key source files reviewed

**Trips:** `src/features/trips/api/trips.service.ts`, `hooks/use-trips.ts`, `lib/trip-business-date.ts`, `lib/trip-price-engine.ts`, `lib/trip-status.ts`, `types.ts`  
**Dashboard:** `src/app/dashboard/overview/layout.tsx`, `src/features/dashboard/lib/stats-utils.ts`, `occupancy-utils.ts`  
**Invoices:** `src/features/invoices/api/invoices.api.ts`, `types/invoice.types.ts`, `hooks/use-invoice-revenue-total.ts`  
**Drivers:** `src/features/driver-management/types.ts`, `api/drivers.service.ts`; `driver_profiles` in `database.types.ts`  
**Payers:** `src/features/payers/types/payer.types.ts`, `api/payers.service.ts`  
**Schema types:** `src/types/database.types.ts` (incomplete vs production)  
**Migrations:** all 101 files under `supabase/migrations/`  
**Docs:** `docs/plans/reporting-audit.md`, `docs/plans/timezone-master-audit.md`, `docs/abrechnung-overview.md`, `docs/trips-date-filter.md`, `docs/access-control.md`, `docs/billing-families-variants.md`, `docs/kts-architecture.md`, `docs/price-calculation-engine.md`

---

## Appendix C — Suggested CFO metric mapping (design input, not implemented)

| CFO question | Suggested source | Caveat |
|--------------|------------------|--------|
| Revenue recognized this month | `SUM(invoice_line_items.net_amount)` joined to `invoices` where `status IN ('sent','paid')` and `period_*` or `line_date` in month | Use snapshots, not live trips |
| Cash collected this month | `SUM(invoices.total) WHERE paid_at IN month` | Invoice-level only |
| Trips delivered today | `COUNT(*) WHERE status IN ('completed') AND Berlin date` | Only 4 completed in DB today — metric may be empty until driver workflow adoption |
| Scheduled capacity today | `COUNT(*) WHERE status NOT IN ('cancelled') AND Berlin date` | Operational, not revenue |
| Revenue by Kostenträger | Group trips or line items by `payer_id` | 63% missing variant; payer_id OK |
| Average km per trip | `AVG(COALESCE(manual_distance_km, driving_distance_km))` | Exclude NULLs explicitly |
| VAT liability | Invoice `tax_amount` buckets or line item `tax_rate` | Trip `tax_rate` is plan rate, not collected tax |

---

## Implementation Status (2026-05-30)

The Controlling dashboard was implemented at **`/dashboard/controlling`**. See [`docs/controlling-module.md`](../controlling-module.md).

| Audit finding | Status |
|---------------|--------|
| No dedicated CFO route | **Addressed** — `/dashboard/controlling` with sidebar nav |
| Overview stats use browser-local dates | **Deferred** — `stats-utils.ts` / `overview/layout.tsx` unchanged by design |
| Full-table client trip fetches for KPIs | **Addressed** — 5 Supabase RPCs with Berlin TZ |
| Invoice KPIs scattered client-side | **Addressed** — `get_controlling_invoice_kpis` RPC |
| Heatmap / occupancy uses local TZ | **Addressed** — new heatmap RPC (ISODOW−1, Berlin hour) |
| Vehicle utilization | **Deferred** — `vehicle_id` unpopulated |
| SLA / on-time (`actual_pickup_at`) | **Deferred** — field sparse |
| Margin / driver cost | **Deferred** — no cost data |
| Revenue truth: trips vs invoices | **Partial** — Controlling shows trip `net_price`; invoice KPIs separate; CFO must reconcile both |
| `billing_variant_id` sparse on history | **Known** — PayerBreakdown is data-driven; variant rows sparse |

---

*End of audit. No code, schema, or data was modified during the original audit pass.*
