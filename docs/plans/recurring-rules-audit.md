# Recurring Rules Audit

Read-only audit for Plan C (stable coordinates on `recurring_rules`). Sources: `src/types/database.types.ts`, `supabase/migrations/`, `src/app/dashboard/regelfahrten/`, client recurring UI, `recurring-rules.service.ts`, `src/app/api/cron/generate-recurring-trips/route.ts`, `src/lib/google-geocoding.ts`, and repository-wide `.from('recurring_rules')` usage.

---

## Q1 — Schema

### 1. Columns (`recurring_rules`) per `database.types.ts`

**Row** (each column: TypeScript type as generated — reflects nullability for nullable DB columns):

| Column | Type |
|--------|------|
| `id` | `string` |
| `client_id` | `string` |
| `rrule_string` | `string` |
| `pickup_address` | `string` |
| `dropoff_address` | `string` |
| `pickup_time` | `string \| null` |
| `return_mode` | `string` |
| `return_trip` | `boolean` |
| `return_time` | `string \| null` |
| `start_date` | `string` |
| `end_date` | `string \| null` |
| `is_active` | `boolean` |
| `created_at` | `string` |
| `payer_id` | `string \| null` |
| `billing_variant_id` | `string \| null` |
| `kts_document_applies` | `boolean` |
| `kts_source` | `string \| null` |
| `no_invoice_required` | `boolean` |
| `no_invoice_source` | `string \| null` |
| `fremdfirma_id` | `string \| null` |
| `fremdfirma_payment_mode` | `string \| null` |
| `fremdfirma_cost` | `number \| null` |

**Insert** / **Update**: same fields with optionals as appropriate for partial writes (see `src/types/database.types.ts` around the `recurring_rules` table definition).

### 2. Pickup / dropoff address storage

- **Only** `pickup_address` and `dropoff_address`, both **single string** display lines on the rule row.
- There are **no** separate `street` / `zip` / `city` columns on `recurring_rules`. Structured address parts are produced later by geocoding in the cron when building trips.

### 3. Lat/lng on `recurring_rules` today

- **No.** Generated types show no `pickup_lat`, `pickup_lng`, `dropoff_lat`, or `dropoff_lng` on `recurring_rules`.

### 4. `place_id` on `recurring_rules` today

- **No** `place_id` (or similar) column on `recurring_rules` in `database.types.ts`.

### Migrations in this repo touching `recurring_rules`

There is **no** `CREATE TABLE public.recurring_rules` in the tracked `supabase/migrations/` tree; only **ALTER** migrations:

- `20260327120000_recurring_rules_billing.sql` — `payer_id`, `billing_variant_id` (nullable UUID FKs).
- `20260328120000_recurring_rules_return_mode.sql` — `return_mode` `text` NOT NULL with check constraint (`none` \| `time_tbd` \| `exact`).
- `20260403120000_kts_catalog_and_trips.sql` — `kts_document_applies`, `kts_source`.
- `20260404103000_no_invoice_fremdfirma_recurring.sql` — `no_invoice_required`, `no_invoice_source`, Fremdfirma mirror columns + check on `fremdfirma_payment_mode`.
- `20260417000000_nullable-pickup-time.sql` — `pickup_time` nullable.

The base table definition predates or lives outside these files.

---

## Q2 — Regelfahrten page

### 1. File paths

- **Page (RSC):** `src/app/dashboard/regelfahrten/page.tsx` — loads all rules via `getAllRules()`, filters/sorts/paginates, renders `RecurringRulesOverview`.
- **List shell / create entry:** `src/features/recurring-rules/components/recurring-rules-overview.tsx` — toolbar “Neue Regelfahrt” opens `CreateRecurringRuleSheet`.
- **Create flow UI:** `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx` — two-step sheet (pick client, then form).
- **Form body (shared):** `src/features/clients/components/recurring-rule-form-body.tsx` — `RecurringRuleFormBody` with pickup/dropoff `AddressAutocomplete`.

### 2. Pickup / dropoff fields in the form

- **`AddressAutocomplete`** from `src/features/trips/components/address-autocomplete.tsx` (imported in `recurring-rule-form-body.tsx`).
- Users can type free text (string `onChange`) or complete a Places-style flow; when structured parts exist, the handler **collapses** street, PLZ, and city into one **display string** stored in RHF as `pickup_address` / `dropoff_address`.

### 3. Submit mechanism

- **No** server action and **no** dedicated REST route for create.
- **`recurringRulesService.createRule(rule)`** in `src/features/trips/api/recurring-rules.service.ts` — browser Supabase client **`.insert()`** into `recurring_rules`.

### 4. Address data available at submit

- **Persisted:** only `values.pickup_address` and `values.dropoff_address` **strings** via `buildRecurringRulePayload` (`src/features/clients/lib/build-recurring-rule-payload.ts`).
- **Not** written to the rule row: lat/lng, `placeId`, or structured fields from `AddressResult` — the form’s `onChange` handlers only call `field.onChange` with a string (built line or `result.address` while typing).

---

## Q3 — Clients page rule creation

### 1. Relevant paths

- **Classic client edit:** `src/app/dashboard/clients/[id]/page.tsx` renders `ClientForm`; recurring rules are managed inside the client feature (list + sheet), not on a separate `/passengers` route in this tree.
- **Sheet (overlay):** `src/features/clients/components/recurring-rule-sheet.tsx` — used from `src/features/clients/components/recurring-rules-list.tsx`.
- **Panel (Miller columns):** `src/features/clients/components/recurring-rule-panel.tsx` — used from `src/features/clients/components/clients-column-view.tsx`.

### 2. Same form as Regelfahrten?

- **Yes.** Both Regelfahrten’s `CreateRecurringRuleSheet` and the client flows use **`RecurringRuleFormBody`** + **`buildRecurringRulePayload`**.

### 3. Submit and address data

- **Same as Q2:** `buildRecurringRulePayload` + **`recurringRulesService.createRule`** or **`updateRule`** (browser Supabase insert/update). No server action / API route for those writes.
- **At submit:** only the two address **strings** are part of the rule payload; lat/lng/placeId are not stored on `recurring_rules`.

---

## Q4 — Other write paths

### 1. Inserts / updates / deletes (code)

| Path | Operation |
|------|-----------|
| `src/features/trips/api/recurring-rules.service.ts` | `.insert()`, `.update()`, `.delete()` on `recurring_rules` (used by all UI saves and deletes). |
| `src/features/trips/api/recurring-exceptions.actions.ts` | `cancelRecurringSeries`: `.update({ is_active: false })` on `recurring_rules` when cancelling a series. |
| `src/app/api/cron/generate-recurring-trips/route.ts` | **Read-only** `.select` on `recurring_rules` (no insert/update to rules). |

### 2. Reads only (not writes)

- `src/features/trips/api/recurring-rules.server.ts` — `getAllRules` / listing.
- `src/features/invoices/hooks/use-client-payers.ts` — `.from('recurring_rules')` **select** (usage check / payer context).

### 3. API routes under `src/app/api/`

- **No** route file under `src/app/api/` (other than the cron above) was found that inserts or updates `recurring_rules` (grep of `.from('recurring_rules')`).

### 4. Bulk import / CSV for recurring rules

- **None found** in this audit (no CSV/upload path referencing `recurring_rules` in the searched code paths).

---

## Q5 — Cron / materialisation

### 1. Cron endpoint path

- **`src/app/api/cron/generate-recurring-trips/route.ts`** (`GET`, `dynamic = 'force-dynamic'`, auth via `CRON_SECRET`).

### 2. Fields read from each rule row

From the rule object throughout the job (including `buildTripPayload`):

- Identity / schedule: `id`, `client_id`, `rrule_string`, `start_date`, `end_date`, `pickup_time`, `return_mode`, `return_trip`, `return_time`, `is_active`.
- Addresses: `pickup_address`, `dropoff_address`.
- Billing / mirrors copied to trips: `payer_id`, `billing_variant_id`, `kts_document_applies`, `kts_source`, `no_invoice_required`, `no_invoice_source`, `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`.
- Join: `billing_variants(billing_type_id)` on the same select for `billing_type_id` on generated trips.

Exception rows (`recurring_rule_exceptions`) can override pickup/dropoff **strings** and times per occurrence.

### 3. Geocoding function and input

- **`resolveGeoLine(line)`** calls **`geocodeAddressLineToStructured(key)`** with **`line.trim()`** as the cache key and API input.
- **`pickupAddress` / `dropoffAddress`** are built from exception overrides or, for return legs, **swapped** `rule.dropoff_address` / `rule.pickup_address` — always **raw string lines**, not structured DB columns from the rule.

`geocodeStructuredAddressToLatLng` exists in `google-geocoding.ts` but **is not** used by this cron path.

### 4. `resolveDrivingMetricsWithCache` call

- After geocoding, if both legs resolve: rounded coordinates (`COORD_PRECISION`) build an in-memory key; **`resolveDrivingMetricsWithCache(pickupGeo.lat, pickupGeo.lng, dropoffGeo.lat, dropoffGeo.lng, supabase, client.company_id)`** is called with the **geocoded** lat/lng values.
- Trip insert then sets `pickup_lat` / `pickup_lng` / `dropoff_lat` / `dropoff_lng` from the **`GeocodedAddressLineResult`**, plus structured fields from that result.

### 5. Reuse of coordinates from existing trips

- **No.** Geocoding runs per leg from the **address string** each time `buildTripPayload` needs coordinates. The only caches in this handler are:
  - **`geoCache`**: `Map` keyed by **trimmed address string**, scoped to **one cron invocation**.
  - **`drivingMetricsCache`**: in-memory dedupe for **`resolveDrivingMetricsWithCache`** within the same run.
- **`route_metrics_cache`** (via `resolveDrivingMetricsWithCache`) reuses **driving distance/duration** for the same rounded coordinate pairs across runs — **not** geocode results.

### 6. How many `recurring_rules` rows exist?

- **Not derivable** from this repository without querying a database or having a checked-in dataset that enumerates rules. No seed/fixture count was found for `recurring_rules`.

---

## Q6 — Geocoding behaviour

### 1. `geocodeAddressLineToStructured` return type

`GeocodedAddressLineResult` (`src/lib/google-geocoding.ts`):

- `lat`, `lng` (numbers)
- `street`, `street_number`, `zip_code`, `city` (`string | null`)
- `formatted_address` (`string | null`)

### 2. Input normalisation

- **`addressLine?.trim()`** before calling the API. **No** lowercase, abbreviation expansion, or other string normalisation beyond trim.
- Request parameters: `language=de`, `components=country:DE` (bias Germany).

### 3. Non-determinism / varying results across calls

- The implementation takes **`data.results[0]`** (first Geocoding API result). The same string could yield **different** coordinates or structured components if Google’s result ordering or underlying data changes, or if the query is ambiguous (multiple matches).
- Optional **reverse geocode PLZ fallback** (`reverseGeocodeLatLngToPostalCode`) runs when the postal code is missing or not five digits — that adds another API dependency chain but still anchors on the first forward-geocode result’s geometry.

---

## Summary — what Plan C needs to change

Plan C must add **nullable or required lat/lng columns** (and optionally place IDs) on **`recurring_rules`**, regenerate **`database.types.ts`**, and **populate them at every write path** that today only stores `pickup_address` / `dropoff_address`: namely **`recurringRulesService.createRule` / `updateRule`** callers — which all funnel through **`buildRecurringRulePayload`** and **`RecurringRuleFormBody`** (`CreateRecurringRuleSheet`, **`RecurringRuleSheet`**, **`RecurringRulePanel`**). **`cancelRecurringSeries`** only toggles `is_active` and does not need coordinates unless you add triggers for partial updates. The **cron** (`generate-recurring-trips`) should **prefer persisted rule coordinates** when present and fall back to **`geocodeAddressLineToStructured`** for legacy rows or missing values; it must still handle **exception** address overrides (those strings may still require geocoding unless exceptions gain their own stored coordinates). The **highest-risk** area is **keeping rule coordinates in sync** when addresses are edited or when users paste incomplete strings (today only strings are saved), plus **backfilling** existing rules and defining behaviour when geocoding fails or keys drift from stored coords.
