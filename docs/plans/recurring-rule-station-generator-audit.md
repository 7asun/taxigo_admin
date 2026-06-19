# Recurring Rule Station Generator Audit

Status: Audit only

Scope: `pickup_station` / `dropoff_station` route/passenger station fields for trips generated from `recurring_rules`. Billing metadata columns (`billing_calling_station`, `billing_betreuer`) are a separate concept; the migration explicitly documents them as distinct from passenger stations (`supabase/migrations/20260330120000_trips_billing_calling_station_betreuer.sql:1-11`).

## Executive Summary

The generator path is centralized and safe to extend: all recurring-rule trip materialization goes through `generateRecurringTrips()` in `src/lib/recurring-trip-generator.ts`. That function currently queries the persisted rule fresh from Supabase, creates one trip insert per generated leg, and explicitly writes `pickup_station: null` and `dropoff_station: null` for every generated trip (`src/lib/recurring-trip-generator.ts:267-319`).

There is no `pickup_station` or `dropoff_station` column on `recurring_rules` in the generated database types (`src/types/database.types.ts:893-980`) or in the tracked recurring-rule migrations (`supabase/migrations/20260327120000_recurring_rules_billing.sql:8-13`, `supabase/migrations/20260328120000_recurring_rules_return_mode.sql:2-20`, `supabase/migrations/20260505120000_add-coords-to-recurring-rules.sql:5-23`, `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql:142-181`, `supabase/migrations/20260514120000_reha_schein.sql:13-14`). The trip table already supports route stations (`src/types/database.types.ts:1510`, `src/types/database.types.ts:1534`, `src/types/database.types.ts:1596-1620`).

## 1. Complete Recurring-Rule Trip Creation Paths

1. On-demand generation after creating a rule from a client rule sheet:
   - Entry point: `RecurringRuleSheet.handleSubmit()` in create mode calls `runCreateWithGeneration(payload)` (`src/features/clients/components/recurring-rule-sheet.tsx:179-244`).
   - Flow: `runCreateWithGeneration()` calls `createRecurringRule(payload)`, then `triggerGenerationForRule(data.id)` (`src/features/clients/lib/recurring-rule-submit-flow.ts:74-91`).
   - Generator call: `triggerGenerationForRule(ruleId)` calls `generateRecurringTrips({ ruleId })` (`src/features/trips/api/recurring-rules.actions.ts:253-261`).

2. On-demand generation after creating a rule from the client Miller-column panel:
   - Entry point: `RecurringRulePanel.handleSubmit()` in create mode calls `runCreateWithGeneration(payload)` (`src/features/clients/components/recurring-rule-panel.tsx:207-271`).
   - Same server-action chain as above.

3. On-demand generation after creating a rule from the cross-client Regelfahrten overview:
   - Entry point: `CreateRecurringRuleSheet.handleSubmit()` calls `runCreateWithGeneration(ruleData)` (`src/features/recurring-rules/components/create-recurring-rule-sheet.tsx:185-214`).
   - Same server-action chain as above.

4. Nightly cron:
   - Entry point: `GET /api/cron/generate-recurring-trips` (`src/app/api/cron/generate-recurring-trips/route.ts:8-49`).
   - Auth: `CRON_SECRET` via bearer or `x-cron-secret`; fails closed if secret/env are missing (`src/app/api/cron/generate-recurring-trips/route.ts:10-34`).
   - Generator call: `generateRecurringTrips()` with no `ruleId`, so all active rules are considered (`src/app/api/cron/generate-recurring-trips/route.ts:36`).

5. Manual admin trigger:
   - There is a server action, `triggerGenerationForRule(ruleId)`, that can be called by admin UI code after tenant validation (`src/features/trips/api/recurring-rules.actions.ts:253-261`).
   - The current code search only found create-flow callers, not a separate manual "generate now" button.

6. Bulk upload and other trip creation paths:
   - CSV bulk upload creates normal trips through `tripsService.bulkCreateTrips()` and may create auto-return trips, but it does not create trips from `recurring_rules` (`src/features/trips/components/bulk-upload-dialog.tsx:1108-1410`).
   - One-off trip creation creates normal trips through `tripsService.createTrip()`, not recurring-rule trips (`src/features/trips/components/create-trip/create-trip-form.tsx:1371-1671`).
   - Trip duplication clears `rule_id`, so duplicated rows are explicitly not tied to recurring rules (`src/features/trips/lib/duplicate-trips.ts:1-5`, `src/features/trips/lib/duplicate-trips.ts:348-370`).

## 2. Columns Copied Or Derived From `recurring_rules`

The generator reads rules using `.select('*, billing_variants(billing_type_id)')` (`src/lib/recurring-trip-generator.ts:76-90`) and builds each trip in `buildTripPayload()` (`src/lib/recurring-trip-generator.ts:147-328`).

Directly copied from the rule to the trip:

- `payer_id` -> `trips.payer_id` (`src/lib/recurring-trip-generator.ts:272`).
- `billing_variant_id` -> `trips.billing_variant_id` (`src/lib/recurring-trip-generator.ts:273`).
- `kts_document_applies` -> `trips.kts_document_applies` (`src/lib/recurring-trip-generator.ts:274`).
- `reha_schein` -> `trips.reha_schein` (`src/lib/recurring-trip-generator.ts:275`).
- `kts_source` -> `trips.kts_source` (`src/lib/recurring-trip-generator.ts:276`).
- `no_invoice_required` -> `trips.no_invoice_required` (`src/lib/recurring-trip-generator.ts:277`).
- `no_invoice_source` -> `trips.no_invoice_source` (`src/lib/recurring-trip-generator.ts:278`).
- `fremdfirma_id` -> `trips.fremdfirma_id` (`src/lib/recurring-trip-generator.ts:279`).
- `fremdfirma_payment_mode` -> `trips.fremdfirma_payment_mode` (`src/lib/recurring-trip-generator.ts:280`).
- `fremdfirma_cost` -> `trips.fremdfirma_cost` (`src/lib/recurring-trip-generator.ts:281`).
- `id` -> `trips.rule_id` (`src/lib/recurring-trip-generator.ts:312`).

Derived from rule fields:

- `pickup_address` / `dropoff_address` are copied for outbound legs and swapped for return legs, unless an exception overrides them (`src/lib/recurring-trip-generator.ts:193-198`).
- `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` are reused when the rule has all four coordinates and no address exception, swapped for return legs (`src/lib/recurring-trip-generator.ts:214-231`).
- `pickup_time` drives outbound `scheduled_at`; `return_time` drives exact return `scheduled_at`; both are modified by matching exceptions when present (`src/lib/recurring-trip-generator.ts:185-191`, `src/lib/recurring-trip-generator.ts:492-502`, `src/lib/recurring-trip-generator.ts:557-568`).
- `return_mode` controls whether no return, exact return, or time-to-be-decided return is generated (`src/lib/recurring-trip-generator.ts:481`, `src/lib/recurring-trip-generator.ts:548-568`).
- `billing_variants.billing_type_id` from the joined variant is written to `trips.billing_type_id` (`src/lib/recurring-trip-generator.ts:515`, `src/lib/recurring-trip-generator.ts:581`).
- `rrule_string`, `start_date`, `end_date`, and `is_active` determine eligible occurrence dates but are not copied to trip columns (`src/lib/recurring-trip-generator.ts:76-85`, `src/lib/recurring-trip-generator.ts:436-479`).

## 3. Hardcoded Or Null Trip Columns

Hardcoded by the generator payload:

- `pickup_station: null` for every generated leg (`src/lib/recurring-trip-generator.ts:299`).
- `dropoff_station: null` for every generated leg (`src/lib/recurring-trip-generator.ts:307`).
- `ingestion_source: 'recurring_rule'` (`src/lib/recurring-trip-generator.ts:313`).
- `status: 'pending'` for normal recurring trips (`src/lib/recurring-trip-generator.ts:282-288`).
- For Fremdfirma rules: `driver_id: null`, `needs_driver_assignment: false`, `status: 'assigned'` (`src/lib/recurring-trip-generator.ts:282-287`).
- `gross_price: null` and `tax_rate: null` before price computation is applied (`src/lib/recurring-trip-generator.ts:317-318`, `src/lib/recurring-trip-generator.ts:520-537`, `src/lib/recurring-trip-generator.ts:586-603`).
- `scheduled_at: null` for timeless outbound rules and `return_mode = 'time_tbd'` returns (`src/lib/recurring-trip-generator.ts:486-502`, `src/lib/recurring-trip-generator.ts:557-568`).
- Outbound `link_type` starts as `null`; if a return leg is inserted, the outbound row is later updated to `link_type: 'outbound'` and `linked_trip_id: <return id>` (`src/lib/recurring-trip-generator.ts:504-516`, `src/lib/recurring-trip-generator.ts:614-620`).
- Return legs use `link_type: 'return'` and `linked_trip_id: <outbound id>` (`src/lib/recurring-trip-generator.ts:264`, `src/lib/recurring-trip-generator.ts:570-582`).

Columns available on `trips` but not populated by the generator include `billing_calling_station`, `billing_betreuer`, `pickup_place_id`, `dropoff_place_id`, `created_by`, `payment_method`, `vehicle_id`, `group_id`, `stop_order`, `notes`, and `note`; these are omitted from the insert payload and therefore remain DB defaults/null.

## 4. Rule Variants And Column Differences

- Outbound-only (`return_mode = 'none'`): one outbound trip is generated per occurrence. `link_type` remains `null`, `linked_trip_id` remains `null`, route uses rule pickup -> dropoff, and both station columns are currently `null` (`src/lib/recurring-trip-generator.ts:504-548`).
- Exact return (`return_mode = 'exact'`): outbound is inserted first, return is inserted second with swapped pickup/dropoff address and coordinates, exact `return_time`-derived `scheduled_at`, `link_type = 'return'`, and `linked_trip_id = outboundId`; outbound is then backfilled to `link_type = 'outbound'` and `linked_trip_id = returnId` (`src/lib/recurring-trip-generator.ts:550-620`).
- Time-to-be-decided return (`return_mode = 'time_tbd'`): same swapped route and linking as exact returns, but return `scheduled_at` is `null` and the exception key uses `RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME` (`src/lib/recurring-trip-generator.ts:552-568`).
- Timeless outbound (`pickup_time = null`): outbound is still generated with `scheduled_at = null`; this is documented as daily-agreement mode (`src/lib/recurring-trip-generator.ts:486-502`, `docs/features/recurring-rules-overview.md:103-113`).
- Fremdfirma rules: both outbound and return payloads are assigned without a driver and with `needs_driver_assignment = false`; otherwise they follow the same leg logic (`src/lib/recurring-trip-generator.ts:264-288`).

## 5. Shape Of Generator Input

`generateRecurringTrips()` does not receive the create/update payload. It receives only optional `{ ruleId, supabase }` (`src/lib/recurring-trip-generator.ts:61-64`). It then queries `recurring_rules` fresh from the database:

- `.from('recurring_rules').select('*, billing_variants(billing_type_id)').eq('is_active', true)` (`src/lib/recurring-trip-generator.ts:76-79`).
- Optional `.eq('id', options.ruleId)` for on-demand generation (`src/lib/recurring-trip-generator.ts:81-83`).

The row type is `Database['public']['Tables']['recurring_rules']['Row']` plus `{ billing_variants: { billing_type_id: string } | null }` (`src/lib/recurring-trip-generator.ts:52-53`, `src/lib/recurring-trip-generator.ts:87-90`). All current `recurring_rules` columns from `database.types.ts` are available at generation time, but no station columns exist there (`src/types/database.types.ts:893-980`).

## 6. Insert Location And Mechanism

Generated trips are inserted into `public.trips` via the Supabase client held by the generator. By default this is `createAdminClient()`, which uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS (`src/lib/recurring-trip-generator.ts:61-66`, `src/lib/supabase/admin.ts:1-24`).

The actual insert is in `insertIfAbsent()`:

- Dedupe query selects existing trips by `client_id`, `rule_id`, `requested_date`, and leg direction (`src/lib/recurring-trip-generator.ts:330-352`).
- Insert call: `.from('trips').insert(row).select('id').single()` (`src/lib/recurring-trip-generator.ts:354-382`).

There is no bulk insert in the recurring generator. It inserts one row per generated leg and performs one additional outbound link update for successful return pairs (`src/lib/recurring-trip-generator.ts:614-620`).

## 7. RLS Policies Or Triggers

Tracked RLS policies should not block the normal recurring generator:

- `trips` has RLS enabled and admin insert is allowed when `company_id = current_user_company_id()` (`supabase/migrations/20260409170000_add_missing_rls.sql:15-27`).
- The recurring generator normally uses the service-role client, which bypasses RLS (`src/lib/supabase/admin.ts:1-24`).
- The on-demand server action checks the authenticated admin and company ownership before calling the service-role generator (`src/features/trips/api/recurring-rules.actions.ts:253-261`, `src/features/trips/api/recurring-rules-admin.ts:13-80`).

No tracked migration defines a `trips` trigger that changes or rejects `pickup_station` / `dropoff_station`. The only tracked station-related migration adds billing metadata columns, not route stations (`supabase/migrations/20260330120000_trips_billing_calling_station_betreuer.sql:1-11`). Existing `trips` RLS policies are company/role based, not station-field based.

## 8. Types, Schemas, And Builders To Update

To let station fields flow from rule form to generated trip:

- DB migration: add nullable station columns to `public.recurring_rules`.
- `src/types/database.types.ts`: regenerate/update `recurring_rules.Row`, `Insert`, and `Update` with the new columns.
- `src/features/clients/components/recurring-rule-form-body.tsx`: add fields, defaults, and Zod validation for rule-level stations.
- `src/features/clients/lib/build-recurring-rule-payload.ts`: include trimmed station values in the insert/update payload.
- `src/lib/recurring-trip-generator.ts`: replace hardcoded station nulls with rule-derived outbound/return values.
- If payer-gated: `src/features/trips/hooks/use-trip-form-data.ts`, `src/features/trips/types/trip-form-reference.types.ts`, `src/features/payers/types/payer.types.ts`, `src/features/payers/api/payers.service.ts`, and payer settings UI must expose the payer flag and make it available in the recurring form.

`trips` insert types already allow `pickup_station` and `dropoff_station` (`src/types/database.types.ts:1596-1620`), so trip insertion does not need a type expansion.

## 9. Existing Paths That Already Write Trip Stations

- One-off trip creation:
  - Passenger state has `pickup_station` and `dropoff_station` (`src/features/trips/types.ts:1-12`).
  - Custom validation requires stations when the billing behavior says so (`src/features/trips/components/create-trip/create-trip-form.tsx:1114-1142`).
  - Passenger outbound rows write `pickup_station: p.pickup_station || null` and `dropoff_station: p.dropoff_station || null` (`src/features/trips/components/create-trip/create-trip-form.tsx:1527-1577`).
  - Passenger return rows swap them: return `pickup_station` gets outbound dropoff station, return `dropoff_station` gets outbound pickup station (`src/features/trips/components/create-trip/create-trip-form.tsx:1614-1671`).
  - Anonymous no-passenger mode explicitly writes both station fields as null (`src/features/trips/components/create-trip/create-trip-form.tsx:1371-1416`, `src/features/trips/components/create-trip/create-trip-form.tsx:1438-1491`).

- CSV bulk upload:
  - CSV row type includes `pickup_station` and `dropoff_station` (`src/features/trips/components/bulk-upload/bulk-upload-types.ts:18-25`).
  - Insert payload writes both fields from CSV cells (`src/features/trips/components/bulk-upload-dialog.tsx:966-1042`).
  - Missing station is a warning, not a blocker, when billing behavior requires it (`src/features/trips/components/bulk-upload-dialog.tsx:1057-1078`).
  - Auto-created return trips swap station fields (`src/features/trips/components/bulk-upload-dialog.tsx:534-574`).

- One-off return helper:
  - `buildReturnTripInsert()` swaps route station fields from an outbound row (`src/features/trips/lib/build-return-trip-insert.ts:20-63`, `src/features/trips/lib/build-return-trip-insert.ts:89-126`).

- Trip duplication:
  - Duplicates copy both route station fields from the source trip and clear `rule_id` (`src/features/trips/lib/duplicate-trips.ts:218-320`, `src/features/trips/lib/duplicate-trips.ts:338-370`).
  - Insertions happen through the duplicate route/service role path (`src/app/api/trips/duplicate/route.ts:20-24`, `src/features/trips/lib/duplicate-trips.ts:421-568`).

- Trip detail editing:
  - Direct detail save patches `pickup_station` and `dropoff_station` when changed (`src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts:141-199`).
  - Paired-leg sync swaps stations to the partner leg when the user updates both directions (`src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts:25-63`, `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts:230-271`).

## 10. Does `recurring_rules` Currently Have Station Columns?

No.

From migrations:

- Billing migration adds only `payer_id` and `billing_variant_id` to `recurring_rules` (`supabase/migrations/20260327120000_recurring_rules_billing.sql:8-13`).
- Return-mode migration adds only `return_mode` (`supabase/migrations/20260328120000_recurring_rules_return_mode.sql:2-20`).
- Coordinates migration adds only `pickup_lat`, `pickup_lng`, `dropoff_lat`, and `dropoff_lng` (`supabase/migrations/20260505120000_add-coords-to-recurring-rules.sql:5-23`).
- KTS, no-invoice/Fremdfirma, Reha, and nullable pickup-time migrations add no station columns (`supabase/migrations/20260403120000_kts_catalog_and_trips.sql:26-34`, `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql:142-181`, `supabase/migrations/20260514120000_reha_schein.sql:13-14`, `supabase/migrations/20260417000000_nullable-pickup-time.sql:1-6`).

From generated types:

- `recurring_rules.Row`, `Insert`, and `Update` list addresses, coords, times, billing, KTS, no-invoice, Reha, and Fremdfirma fields, but no `pickup_station` or `dropoff_station` (`src/types/database.types.ts:893-980`).

## 11. Minimal Changes For End-To-End Flow

Minimal DB-to-generator flow:

1. Add nullable `pickup_station text` and `dropoff_station text` to `public.recurring_rules`.
2. Regenerate/update Supabase types so `RecurringRuleRow`, `InsertRecurringRule`, and `UpdateRecurringRule` can carry the new fields.
3. Extend the recurring rule form schema/defaults with optional station strings.
4. Extend `buildRecurringRulePayload()` to trim and persist empty values as `null`.
5. Change `generateRecurringTrips()`:
   - Outbound: `pickup_station = rule.pickup_station ?? null`, `dropoff_station = rule.dropoff_station ?? null`.
   - Return: `pickup_station = rule.dropoff_station ?? null`, `dropoff_station = rule.pickup_station ?? null`.
   - Keep exception behavior unchanged unless product also wants per-exception station overrides.
6. Add focused tests for outbound-only, exact return, time-tbd return, and timeless outbound generation.

## 12. Existing Generated Trips, Resync, And Backfill

Yes, generated trips already exist for recurring rules. They are identifiable by `rule_id IS NOT NULL`; the generator also stamps `ingestion_source = 'recurring_rule'` for new rows (`src/lib/recurring-trip-generator.ts:312-313`). Existing rows were generated with `pickup_station = null` and `dropoff_station = null` because the current generator hardcodes those values (`src/lib/recurring-trip-generator.ts:299-307`).

Existing resync is schedule-only:

- `resyncFutureRecurringTrips()` only updates `scheduled_at` (`src/features/trips/api/recurring-rules.actions.ts:149-248`).
- `runUpdateWithCleanup()` only calls it when `pickup_time`, `return_time`, or `return_mode` changes (`src/features/clients/lib/recurring-rule-submit-flow.ts:29-54`, `src/features/clients/lib/recurring-rule-submit-flow.ts:133-151`).
- Docs explicitly say address and billing-only saves are not synced (`docs/features/recurring-rules-overview.md:44-75`).

Recommendation: do not automatically overwrite existing generated trips on the first feature rollout. Add a separate, explicit station resync/backfill if product wants future pending trips to inherit newly saved stations. That action should be pending-only, future-only, and should swap stations for return legs. It should avoid changing completed, cancelled, assigned, in-progress, or invoiced trips without a product review.

## 13. Safest Implementation Order

Recommended order:

1. DB migration: add nullable columns to `recurring_rules` first. This is backward compatible; old app code ignores them.
2. Types: regenerate/update `database.types.ts`. Without this, TypeScript will reject `InsertRecurringRule` / `UpdateRecurringRule` station fields.
3. Generator: update station mapping and tests. Safe after DB/types because the fresh `.select('*')` row will include the new columns and `trips.Insert` already accepts station fields.
4. Payload builder: add station persistence from form values.
5. Form/UI: add fields, defaults, conditional display, and validation last.
6. Optional payer gate: add payer config before exposing the form condition if the feature must be payer-specific.
7. Optional resync/backfill: ship separately behind an explicit action or confirmation.

Ordering constraints:

- Do not update the generator to read `rule.pickup_station` before types are updated, or TypeScript fails.
- Do not let the UI submit station fields before the DB migration is deployed, or Supabase insert/update can fail with unknown columns.
- DB-first is safe because nullable columns do not affect existing rows or generator behavior.
- Generator-before-UI is safe after DB/types because missing rule station values remain null.

## Files That Will Need To Change For The Station Feature

- `supabase/migrations/<timestamp>_recurring_rules_stations.sql`: add nullable `pickup_station` and `dropoff_station` columns to `public.recurring_rules` with comments.
- `src/types/database.types.ts`: regenerate Supabase types so `recurring_rules.Row`, `Insert`, and `Update` include station fields.
- `src/lib/recurring-trip-generator.ts`: map rule station fields into generated outbound legs and swapped return legs instead of hardcoded nulls.
- `src/features/clients/components/recurring-rule-form-body.tsx`: render and validate the station inputs in the shared recurring-rule form.
- `src/features/clients/lib/build-recurring-rule-payload.ts`: include normalized station values in create/update payloads.
- `src/features/clients/components/recurring-rule-panel.tsx`: likely no logic change beyond consuming updated shared form defaults, but verify create/edit submit still passes station fields.
- `src/features/clients/components/recurring-rule-sheet.tsx`: likely no logic change beyond consuming updated shared form defaults, but verify create/edit submit still passes station fields.
- `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx`: verify overview create flow passes station fields through the shared builder.
- `src/features/trips/hooks/use-trip-form-data.ts`: if payer-gated, fetch the payer station flag used to decide whether station inputs are shown/required.
- `src/features/trips/types/trip-form-reference.types.ts`: if payer-gated, add the payer station flag to `PayerOption`.
- `src/features/payers/types/payer.types.ts`: if payer-gated, add the payer config field to payer UI/service types.
- `src/features/payers/api/payers.service.ts`: if payer-gated, select and update the payer station flag.
- `src/features/payers/components/payer-details-sheet.tsx`: if payer-gated, expose the payer-level station toggle.
- `src/features/trips/lib/__tests__/recurring-trip-generator*.test.ts` or equivalent: add coverage for station propagation and return-leg swapping.
- `docs/features/recurring-rules-overview.md`: document station propagation and clarify it is route station, not `billing_calling_station`.
- `docs/plans/payer-station-recurring-rules-audit.md`: update status/decision if product confirms the payer-gated route-station scope.

## Top 3 Generator-Specific Risks

1. Return-leg swapping: using outbound stations unchanged on return legs would invert the real route semantics. Return `pickup_station` must come from rule `dropoff_station`, and return `dropoff_station` must come from rule `pickup_station`.
2. Existing generated trips: future rows already materialized with null stations will not change unless an explicit station resync/backfill is added. Silent partial rollout could make new trips look correct while existing future trips remain blank.
3. Concept collision: `pickup_station` / `dropoff_station` are route/passenger fields; `billing_calling_station` is billing metadata. Reusing the wrong "Station" concept would put data in the wrong columns and confuse exports/invoices.

## Go / No-Go Recommendation

Go for the generator path after adding DB columns and regenerated types. There is no generator architecture blocker, no station-specific RLS blocker, and no tracked trigger that interferes with station values.

No-go only if the product requirement is still ambiguous about which "Station" is intended. For the specific scope of `pickup_station` / `dropoff_station`, the safest implementation is straightforward: DB/types first, generator mapping second, form/payer-gating last, with any existing-trip station resync as a separate explicit decision.
