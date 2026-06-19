# Alle Regelfahrten (overview)

Cross-client list of recurring trip rules at **`/dashboard/regelfahrten`**: dispatchers see every rule with Fahrgast, schedule, addresses, Rückfahrt, billing, and status in one sortable, filterable table. Row links still go to Fahrgast Stammdaten (`/dashboard/clients/[id]`) for editing existing rules; **new** rules can be created from this page (see **Create flow** below).

**Architecture:** The RSC page loads data with [`getAllRules`](../../src/features/trips/api/recurring-rules.server.ts) (server Supabase client), applies guest filter, sort, and pagination slice from URL search params (same manual-table contract as Fahrten), then passes one page of rows into a client [`RecurringRulesOverview`](../../src/features/recurring-rules/components/recurring-rules-overview.tsx) that uses `useDataTable` + `DataTable` + `DataTableToolbar`.

## Create flow

- **Entry:** **Neue Regelfahrt** in the table toolbar (right side, same slot pattern as `DataTableToolbar` children elsewhere).
- **Sheet (two steps):**
  1. **Fahrgast wählen** — searchable list (debounced browser Supabase query; empty query shows an alphabetical browse slice). **Weiter** moves on only after a row is selected.
  2. **Regel** — same fields and validation as [`RecurringRuleSheet`](../../src/features/clients/components/recurring-rule-sheet.tsx) via shared [`RecurringRuleFormBody`](../../src/features/clients/components/recurring-rule-form-body.tsx). **Zurück** returns to step 1 without closing the Sheet; **Hinzufügen** calls `createRecurringRule` then `triggerGenerationForRule`.
- **After success:** toast includes generated trip count for the Berlin **14-day** window, Sheet closes, **`router.refresh()`** re-runs the RSC page so `getAllRules()` returns the new row (no TanStack list key for this table — same idea as [`client-form.tsx`](../../src/features/clients/components/client-form.tsx) after save).
- **On-demand generation:** after create, [`triggerGenerationForRule`](../../src/features/trips/api/recurring-rules.actions.ts) runs [`generateRecurringTrips`](../../src/lib/recurring-trip-generator.ts) scoped to the new rule (same logic as nightly cron). Generation failure is **non-fatal** — the rule is saved; the nightly cron at 03:00 UTC recovers.

Implementation: [`create-recurring-rule-sheet.tsx`](../../src/features/recurring-rules/components/create-recurring-rule-sheet.tsx), [`use-client-search.ts`](../../src/features/recurring-rules/hooks/use-client-search.ts).

## Files

| Path | Role |
|------|------|
| [`src/features/trips/api/recurring-rules.server.ts`](../../src/features/trips/api/recurring-rules.server.ts) | `getAllRules()`, `RecurringRuleWithClientEmbed` (PostgREST embeds: `billing_variant:billing_variants`, `clients`). |
| [`src/app/dashboard/regelfahrten/page.tsx`](../../src/app/dashboard/regelfahrten/page.tsx) | RSC: URL-driven filter / sort / slice; `PageContainer`. |
| [`src/features/recurring-rules/components/recurring-rules-overview.tsx`](../../src/features/recurring-rules/components/recurring-rules-overview.tsx) | Client table + toolbar + pagination props; create Sheet trigger + `router.refresh()`. |
| [`src/features/recurring-rules/components/create-recurring-rule-sheet.tsx`](../../src/features/recurring-rules/components/create-recurring-rule-sheet.tsx) | Two-step Sheet: client pick → rule form (create only). |
| [`src/features/recurring-rules/hooks/use-client-search.ts`](../../src/features/recurring-rules/hooks/use-client-search.ts) | Debounced client search for step 1 (browser Supabase). |
| [`src/features/recurring-rules/components/recurring-rules-columns.tsx`](../../src/features/recurring-rules/components/recurring-rules-columns.tsx) | Column definitions (`'use client'`). |
| [`src/features/recurring-rules/lib/recurring-rules-sort-column-ids.ts`](../../src/features/recurring-rules/lib/recurring-rules-sort-column-ids.ts) | `RECURRING_RULES_SORT_COLUMN_IDS` for `getSortingStateParser` — **not** in the client columns module so the RSC page receives a real `Set`. |
| [`src/features/recurring-rules/lib/recurring-rules-formatters.ts`](../../src/features/recurring-rules/lib/recurring-rules-formatters.ts) | Server-safe pure formatters (`formatRecurringRuleGuestLabel`, `formatRecurringRuleByDayAbbrev`) — safe to import from RSC pages and server utilities; re-exported from `recurring-rules-columns.tsx` for client consumers. |
| [`src/config/nav-config.ts`](../../src/config/nav-config.ts) | Top-level nav item **Regelfahrten** after **Fahrten**. |
| [`src/query/keys/recurring.ts`](../../src/query/keys/recurring.ts) | TanStack keys for expiry banner (`recurringKeys`). |
| [`src/features/dashboard/hooks/use-expiring-recurring-rules.ts`](../../src/features/dashboard/hooks/use-expiring-recurring-rules.ts) | Overview expiry banner data hook. |
| [`src/features/dashboard/components/expiring-rules-banner.tsx`](../../src/features/dashboard/components/expiring-rules-banner.tsx) | Overview expiry banner UI. |

If `tsc` or the bundler pulls the server module into the client bundle when columns `import type` from `recurring-rules.server.ts`, extract **`src/features/recurring-rules/types/recurring-rules-overview.types.ts`** with only `RecurringRuleWithClientEmbed` and point server + columns at it (see implementation plan — no other workaround).

## Deferred

- Edit recurring rules inline from this overview (rows still deep-link to the client page).
- Active/inactive and date-range filters on the toolbar.
- `recurring_rules` RLS policies (migration task).
- Server-side pagination beyond URL page slice when row counts grow.

## Regel-Update: Synchronisation bestehender Fahrten

When an admin saves a time change (e.g. 13:45 → 13:30) in `RecurringRulePanel` or `RecurringRuleSheet`, `runUpdateWithCleanup` automatically patches `scheduled_at` on all matching future trips after the rule row is updated.

**Trigger fields:** changes to `pickup_time`, `return_time`, or `return_mode`. All other fields (billing, addresses, date range) do not trigger a resync.

**Affected trips:** only trips with:
- `rule_id = <updated rule>`
- `status = 'pending'` — completed, assigned, and invoiced trips are immutable
- `requested_date >= today` (Berlin civil date, never raw UTC)

**Exception guard:** trips with a matching row in `recurring_rule_exceptions` (same `rule_id`, `exception_date = requested_date`, `original_pickup_time` keyed using the pre-update rule times) are skipped. Their `scheduled_at` is derived from the exception override and must not be overwritten by a rule-level resync.

**Toast copy (German):**
- `resynced > 0` → `Regel aktualisiert. N Fahrten wurden auf die neue Zeit aktualisiert.`
- `deleted > 0` (shorten only, no schedule change) → `Regel aktualisiert. N Fahrten wurden gelöscht.`
- Otherwise → `Regel erfolgreich aktualisiert`

**Explicitly NOT synced:**
- `assigned`, `completed`, `cancelled`, or `invoiced` trips
- Address-only or billing-only saves (different concern; geocoding is separate)
- Trips with an active exception in `recurring_rule_exceptions`
- Shorten-end-date paths (`handleShortenConfirm`) where `existingRule` is not passed — resync is intentionally skipped there unless schedule also changed

**Implementation files:**
| File | Role |
|------|------|
| [`src/features/trips/lib/recurring-trip-schedule.ts`](../../src/features/trips/lib/recurring-trip-schedule.ts) | `computeResyncScheduledAt`, `exceptionOriginalPickupTimeKey`, `clockToHhMmSs` |
| [`src/features/trips/api/recurring-rules.actions.ts`](../../src/features/trips/api/recurring-rules.actions.ts) | `resyncFutureRecurringTrips` server action |
| [`src/features/clients/lib/recurring-rule-submit-flow.ts`](../../src/features/clients/lib/recurring-rule-submit-flow.ts) | `hasScheduleChange` + extended `runUpdateWithCleanup` |

**Deferred:** resyncing non-pending trips, address-change resync (geocoding), UI confirmation dialog for large resync counts, updating `recurring_rule_exceptions` rows when rule time changes.

## End-date shortening cleanup

When an admin **shortens** `end_date` on an existing rule (edit in [`RecurringRuleSheet`](../../src/features/clients/components/recurring-rule-sheet.tsx) or [`RecurringRulePanel`](../../src/features/clients/components/recurring-rule-panel.tsx)):

1. The form compares old vs new `end_date` (`yyyy-MM-dd` from `<Input type="date">`).
2. If pending trips exist with `requested_date > new end_date`, [`ShortenEndDateDialog`](../../src/features/recurring-rules/components/shorten-end-date-dialog.tsx) shows the exact count from [`countFutureTripsAfterDate`](../../src/features/trips/api/recurring-rules.service.ts).
3. On confirm, [`deleteFutureTripsAfterDate`](../../src/features/trips/api/recurring-rules.actions.ts) runs, then the rule row is updated.

**What is deleted:** `pending` trips only, `requested_date` strictly after the new end date, `ingestion_source` = `recurring_rule` or null.

**What is preserved:** `completed`, `cancelled`, **`assigned`**, and **`in_progress`** trips — even if they lie beyond the new end date. Dispatchers must handle those manually.

**Predicate divergence (intentional):** whole-rule delete via [`deleteRule`](../../src/features/trips/api/recurring-rules.service.ts) uses a **broader** status filter (all non-terminal future trips including assigned/in_progress). End-date shorten is **surgical** — do not unify the predicates without a product review.

| Operation | Date filter | Status filter | Intent |
| --- | --- | --- | --- |
| `deleteRule` (+ optional future trips) | `requested_date >= today` (Berlin) | not `completed` / `cancelled` | Rule teardown |
| `deleteFutureTripsAfterDate` | `requested_date > newEndDate` | `pending` only | Calendar window shrink |

## On-demand generation on create

Shared generator: [`src/lib/recurring-trip-generator.ts`](../../src/lib/recurring-trip-generator.ts) (`RECURRING_TRIP_GENERATION_HORIZON_DAYS = 14`).

- **Nightly cron:** `GET /api/cron/generate-recurring-trips` (Vercel, 03:00 UTC) — all active rules.
- **After create:** `triggerGenerationForRule(ruleId)` server action — one rule, same Berlin window, no `CRON_SECRET` exposed to the browser (service role runs in-process on the server).

## Timeless outbound rules (daily-agreement mode)

Some recurring rules are created without a fixed outbound pickup time. This is represented by **`recurring_rules.pickup_time = NULL`**.

- **Meaning**: NULL means *tägliche Zeitabsprache* — the dispatcher confirms the time the day before (no fixed clock schedule stored on the rule).
- **Form representation**: the Abholzeit input is left empty (`''` in the form state). On save, `''` is persisted as NULL instead of an invalid `HH:MM:SS` string.
- **Cron behavior**: for these rules the cron generates the outbound leg with:
  - **`scheduled_at = null`**
  - **`requested_date = <dateStr>`**
  This mirrors the existing `return_mode = 'time_tbd'` return-leg behavior, but for the outbound leg.
- **Phase 2**: these generated timeless outbound trips will be surfaced in the timeless-rule widget so dispatchers can assign the confirmed time.

## Timeless Rule Trips Widget

The dashboard includes a widget that focuses on **tomorrow’s** recurring-rule-generated trips where the dispatcher still needs to confirm a time.

- **What it shows**: trips with `rule_id IS NOT NULL`, `scheduled_at IS NULL`, `status NOT IN ('cancelled','completed')`, and `requested_date = tomorrow`.
- **Grouping**: one row per passenger per day, pairing outbound + return legs by `(rule_id, requested_date, client_id)` and enriching missing partner legs via `linked_trip_id`.
- **Dispatcher workflow**: the widget only sets `scheduled_at` for timeless legs. **Driver assignment is intentionally deferred** to the normal dispatch flow.

## Expiry banner (dashboard)

Persistent countdown on **`/dashboard/overview`**, rendered **above** the timeless-rule widget (sibling, not inside it).

- **When it shows:** active rules (`is_active = true`) with `end_date` on Berlin **today+1**, **today+2**, or **today+3** (`EXPIRY_WARNING_DAYS = 3` in the hook). Rules ending **today** or later than day 3 are excluded.
- **Timezone:** window dates use `todayYmdInBusinessTz` / `ymdToPickerDate` / `instantToYmdInBusinessTz` from [`trip-business-date.ts`](../../src/features/trips/lib/trip-business-date.ts) — same as the timeless widget, not device-local midnight.
- **UI:** up to three shadcn `Alert` rows (amber for morgen / in 2 Tagen, blue for in 3 Tagen), German copy, link to [**Regelfahrten**](/dashboard/regelfahrten). Empty → nothing rendered (no skeleton while loading).
- **Extend window:** change `EXPIRY_WARNING_DAYS` in [`use-expiring-recurring-rules.ts`](../../src/features/dashboard/hooks/use-expiring-recurring-rules.ts) only.
- **Query cache:** `recurringKeys.expiring(day3Ymd)` in [`src/query/keys/recurring.ts`](../../src/query/keys/recurring.ts).

| File | Role |
|------|------|
| [`use-expiring-recurring-rules.ts`](../../src/features/dashboard/hooks/use-expiring-recurring-rules.ts) | Fetches rules; returns `rules`, `day1Ymd`, `day2Ymd`, `day3Ymd` |
| [`expiring-rules-banner.tsx`](../../src/features/dashboard/components/expiring-rules-banner.tsx) | Buckets by `end_date === dayNYmd` (no date math) |
| [`overview/layout.tsx`](../../src/app/dashboard/overview/layout.tsx) | Wires hook → banner → timeless widget |

**Deferred:** inline badge on timeless rows, Regelfahrten row highlight, Fahrten/Kanban badges (see [recurring-rule-expiry-alert-audit.md](../plans/recurring-rule-expiry-alert-audit.md)).

## Route Station Fields (Daueraufträge)

Recurring rules support optional **route/passenger station codes** (`pickup_station` / `dropoff_station`). These are the same station codes stored on `trips.pickup_station` / `trips.dropoff_station` — **not** `billing_calling_station` / `billing_betreuer` (which are billing metadata and unrelated).

### Payer-level gate

The station fields are hidden by default. They appear and become **required** only when the selected payer has **`payers.recurring_rules_station_enabled = true`**.

Admins toggle this flag in the **Kostenträger** settings sheet → **Stationen (Daueraufträge)** switch. The toggle invalidates both the `[PAYERS_QUERY_KEY]` and `referenceKeys.payers()` caches so the recurring-rule form picks up the change immediately on next payer selection.

### Form behavior

- When `recurring_rules_station_enabled = false`: station fields are hidden; the stored value in `recurring_rules.pickup_station` / `recurring_rules.dropoff_station` is always persisted as `null`.
- When `recurring_rules_station_enabled = true`: both **Abfahrtsstation** and **Zielstation** inputs are shown near the corresponding address fields. Both are required before save.
- Validation is enforced at submit time (in `handleSubmit` in each shell), not by the static Zod schema — because the requirement depends on a runtime payer flag.
- Empty strings and whitespace-only values are coerced to `null` before persistence (no empty-string storage).
- All three recurring-rule entry points behave identically: [`RecurringRuleSheet`](../../src/features/clients/components/recurring-rule-sheet.tsx), [`RecurringRulePanel`](../../src/features/clients/components/recurring-rule-panel.tsx), [`CreateRecurringRuleSheet`](../../src/features/recurring-rules/components/create-recurring-rule-sheet.tsx).

### Trip generation (copy / swap)

When [`generateRecurringTrips`](../../src/lib/recurring-trip-generator.ts) materialises trips from a rule:
- **Outbound trips**: `trips.pickup_station = rule.pickup_station`, `trips.dropoff_station = rule.dropoff_station`.
- **Return trips**: stations are **swapped** — the return passenger boards at the outbound dropoff station and alights at the outbound pickup station.
- **Null rule stations**: generated trips receive `null` station values (no effect on payers with the gate off).

The swap is implemented by [`deriveStationsForTrip`](../../src/lib/recurring-trip-generator.ts) (exported, unit-tested).

### Already-generated trips

Already-generated trips are **not backfilled** when a rule's station values change. Only trips generated after the rule save will carry the new station values. Existing trips retain their original (or null) station values.

### Implementation files

| File | Role |
|------|------|
| [`supabase/migrations/20260618120000_recurring_rules_stations.sql`](../../supabase/migrations/20260618120000_recurring_rules_stations.sql) | Adds `pickup_station`, `dropoff_station` to `recurring_rules`; adds `recurring_rules_station_enabled` to `payers`. |
| [`src/features/payers/api/payers.service.ts`](../../src/features/payers/api/payers.service.ts) | `updatePayerRecurringRulesStationEnabled` — single-column updater for the payer gate. |
| [`src/features/payers/components/payer-details-sheet.tsx`](../../src/features/payers/components/payer-details-sheet.tsx) | Immediate-save **Stationen (Daueraufträge)** switch. |
| [`src/features/clients/components/recurring-rule-form-body.tsx`](../../src/features/clients/components/recurring-rule-form-body.tsx) | Station fields in the form body; `validateRecurringRuleStationFields` shared helper. |
| [`src/features/clients/lib/build-recurring-rule-payload.ts`](../../src/features/clients/lib/build-recurring-rule-payload.ts) | Trims and persists station values; empty/whitespace → null. |
| [`src/lib/recurring-trip-generator.ts`](../../src/lib/recurring-trip-generator.ts) | `deriveStationsForTrip` — pure helper for outbound copy / return swap. |
| [`src/features/trips/lib/__tests__/recurring-rule-stations.test.ts`](../../src/features/trips/lib/__tests__/recurring-rule-stations.test.ts) | Focused tests: `deriveStationsForTrip`, `buildRecurringRulePayload` normalization, `validateRecurringRuleStationFields`. |

## Known gaps

RLS on `recurring_rules` is not defined in tracked migrations; behaviour on production depends on the live DB. See [recurring-rules-overview-audit.md](../plans/recurring-rules-overview-audit.md).
