# Recurring Rule Expiry Warning — Audit (Timeless + Timed Trips)

| Status | **Implemented** (2026-06-03) — dashboard 3-day expiry banner |
|--------|----------------------------------------------------------------|

**Scope:** Read-only audit for surfacing a “rule expires tomorrow” warning to admins. Sources: dashboard timeless widget/hook, trips service types, `recurring_rules` schema/types, Regelfahrten UI, cron materialization, and existing alert patterns.

### Implementation index (shipped)

| File | Role |
|------|------|
| [`src/query/keys/recurring.ts`](../../src/query/keys/recurring.ts) | `recurringKeys.expiring(windowEndYmd)` |
| [`src/features/dashboard/hooks/use-expiring-recurring-rules.ts`](../../src/features/dashboard/hooks/use-expiring-recurring-rules.ts) | Berlin window YMDs + Supabase query |
| [`src/features/dashboard/components/expiring-rules-banner.tsx`](../../src/features/dashboard/components/expiring-rules-banner.tsx) | Presentational alerts (props-only dates) |
| [`src/app/dashboard/overview/layout.tsx`](../../src/app/dashboard/overview/layout.tsx) | Mount banner above timeless widget |

**Note on paths:** There is no `src/query/keys.ts`. Trip keys live in `src/query/keys/trips.ts` and are re-exported from `src/query/keys/index.ts` (`@/query/keys`).

---

## 1. Recurring Rule Schema

### Table name

**`public.recurring_rules`** (Supabase/PostgREST table name: `recurring_rules`).

### End-date column

| Property | Value |
|----------|--------|
| **Column** | `end_date` |
| **Type (generated)** | `string \| null` (`src/types/database.types.ts`) |
| **UI label** | “Gültig bis (Optional)” in `recurring-rule-form-body.tsx` |
| **Overview column** | “Gültig bis” in `recurring-rules-columns.tsx` |

There is **no** `until`, `valid_until`, `ends_at`, or `rule_end` column on this table in generated types or tracked migrations.

### Nullability and meaning

- **`end_date` is nullable** (`end_date?: string \| null` on Insert/Update).
- **Persisted semantics:** `buildRecurringRulePayload` maps an empty form value to **`null`**: `end_date: values.end_date || null` (`src/features/clients/lib/build-recurring-rule-payload.ts`).
- **Product meaning of `NULL`:** open-ended recurrence (no fixed end). Evidence:
  - Form copy: optional “Gültig bis”.
  - Regelfahrten sort treats null as “infinity” (empty string sentinel when comparing `end_date`).
  - Cron (`generate-recurring-trips/route.ts`): `ruleEndDateLocal = rule.end_date ? endOfDay(inTz(rule.end_date), …) : windowEndLocal` — without `end_date`, occurrence search is capped only by the cron’s forward window (~14 Berlin days), not by a rule end.

**`start_date`** is required (non-null on Row); recurrence is additionally bounded below by RRule + `start_date` in cron.

### Other termination / lifecycle signals

| Signal | On `recurring_rules`? | Role |
|--------|----------------------|------|
| **`is_active`** | Yes (`boolean`, default true on create) | Cron loads only `.eq('is_active', true)`. `cancelRecurringSeries` sets `is_active: false` (`recurring-exceptions.actions.ts`). Inactive rules stop new materialization. |
| **`cancelled_at` / `max_occurrences`** | **No** in schema | Not present on `recurring_rules` Row in `database.types.ts`. |
| **Rule delete** | N/A (row removed) | `recurringRulesService.deleteRule` optionally deletes future trips by `rule_id`. |
| **`recurring_rule_exceptions`** | Separate table | Per-date skips/modifications (`exception_date`, `is_cancelled`, etc.) — not a series end date. |

### Migrations in repo

Tracked `supabase/migrations/` contains **ALTER** migrations only (billing, return_mode, KTS, coords, nullable `pickup_time`, Fremdfirma, `reha_schein`, etc.). The **base `CREATE TABLE recurring_rules`** is **not** in this tree (see `docs/plans/recurring-rules-audit.md`). Schema truth for columns above is taken from **`src/types/database.types.ts`** and application usage.

**Most recent migration mentioning `recurring_rules`:** `20260514120000_reha_schein.sql` (adds `reha_schein`).

---

## 2. `TimelessRulePair` Type & Hook

### Does `TimelessRulePair` include rule row fields (especially `end_date`)?

**No.** `TimelessRulePair` only aggregates **trip-level** display fields plus embedded legs:

```29:40:src/features/dashboard/hooks/use-timeless-rule-trips.ts
export type TimelessRulePair = {
  id: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  requested_date: string;
  payer_name: string | null;
  billing_label: string;
  billing_color: string | null;
  outbound: TimelessWidgetTrip | null;
  return: TimelessWidgetTrip | null;
};
```

`TimelessWidgetTrip` extends `Trip`; trips carry **`rule_id`** on each leg but **not** `end_date`.

### Does `use-timeless-rule-trips` join `recurring_rules`?

**No.** `fetchTimelessRulePairs` queries **`trips` only**:

- Filters: `rule_id` NOT NULL, `scheduled_at` IS NULL, `requested_date` IN `[todayYmd, tomorrowYmd]` (Berlin via `todayYmdInBusinessTz` / `instantToYmdInBusinessTz`), status not cancelled/completed.
- Partner fetch: second `trips` query by `linked_trip_id`.
- **No** `.select('..., recurring_rules(...)')` or separate rules fetch.

### FK on `Trip` referencing the rule

| Property | Value |
|----------|--------|
| **Column on `trips`** | **`rule_id`** (`string \| null`) |
| **Type alias** | `Trip = Database['public']['Tables']['trips']['Row']` (`trips.service.ts`) |
| **Not used** | `recurrence_rule_id` — no references in codebase |

Generated `trips` Relationships in `database.types.ts` **do not list** a `rule_id → recurring_rules` FK entry (likely incomplete codegen); product/docs still treat `rule_id` as the recurring-rule link (`docs/features/recurring-rules-overview.md`, cron, exceptions).

---

## 3. Timed Recurring Trips — Current UI Surface

### Where timed recurring trips appear (`scheduled_at` set + `rule_id` set)

There is **no dedicated “timed recurring trips” page or widget**. They appear in the **general Fahrten** surfaces:

| Surface | Path / component | How recurring is indicated |
|---------|------------------|----------------------------|
| **Fahrten Liste** | `src/features/trips/components/trips-listing.tsx` (RSC) | `rule_id` on row; time column shows `RepeatIcon` when `!!row.original.rule_id` (`trips-tables/columns.tsx`). |
| **Fahrten Kanban** | Same listing, `view=kanban` | Same trip rows/cards pipeline. |
| **Dashboard stats** | `overview/layout.tsx` → `useTrips()` → `tripsService.getTrips()` | All trips; no rule expiry logic. |
| **Offene Touren** | `PendingToursWidget` / `use-unplanned-trips.ts` | Any trip with `scheduled_at` null **or** `driver_id` null — **includes** recurring and non-recurring; not filtered to `rule_id`. |
| **Fahrgast detail** | `client-trips-panel.tsx` | Selects `rule_id` among trip fields. |
| **Trip detail sheet** | `trip-detail-sheet.tsx` | Recurring scope dialogs / series cancel when `rule_id` present. |

**Not** the primary home for timed legs:

- **`TimelessRuleTripsWidget`** — only `scheduled_at IS NULL` rule trips (today + tomorrow).
- **`/dashboard/regelfahrten`** — **rules** table (`getAllRules`), not materialized trips.

### Grouping / listing by recurring rule

| Grouping | Exists? | Where |
|----------|---------|--------|
| **Trips grouped by rule** | Partial | Timeless widget: one UI row per `(rule_id, requested_date, client_id)` pair. |
| **All trips for one rule** | No first-class UI hook | Only operational queries: delete future trips, cancel series, cron dedup — all filter `.eq('rule_id', …)`. |
| **Rules list** | Yes | `/dashboard/regelfahrten` + per-client `recurring-rules-list.tsx`. |

### Hook/query: “all trips belonging to a recurring rule” (any `scheduled_at`)

**No shared TanStack hook** like `useTripsByRuleId(ruleId)`.

Call sites that load trips by `rule_id` (server actions / services, not dashboard):

- `recurring-rules.service.ts` — delete future trips when deleting rule.
- `recurring-exceptions.actions.ts` — cancel series, skip occurrence lookups.
- `generate-recurring-trips/route.ts` — dedup `findExistingRecurringLegId`.
- `duplicate-trips.ts` — warning when source has `rule_id`.

---

## 4. Alert Feasibility

### Can “rule expires tomorrow” be computed on the frontend from **existing** trip queries?

**Not reliably from timeless or unplanned trip data alone.**

- Trip queries return **`rule_id`** but **not** `recurring_rules.end_date`.
- A trip’s `requested_date` / `scheduled_at` reflects **one occurrence**, not series end.
- A rule can expire tomorrow while today’s/tomorrow’s timeless rows still exist; conversely, a rule expiring tomorrow may have **no** rows in the timeless window (e.g. only timed future legs or no materialized rows yet).

**Frontend-only computation is possible only if `end_date` is added to the data layer**, e.g.:

1. **Dedicated rules query (recommended):** `recurring_rules` where `is_active = true` and `end_date = <tomorrowBerlinYmd>` (and optionally `end_date IS NOT NULL`).
2. **Embed on timeless query:** extend `fetchTimelessRulePairs` select with PostgREST embed `recurring_rules(end_date, is_active, …)` keyed by `rule_id` (requires FK in DB; embed name must match PostgREST).
3. **Regelfahrten RSC data:** `getAllRules()` already returns `end_date` for every rule — usable on that page without new fields, but **not** currently passed to dashboard widgets.

**Berlin date:** use `todayYmdInBusinessTz()` + same tomorrow helper as `useTimelessRuleTrips` (not device-local `format(addDays(new Date(), 1), …)`).

### Timed recurring trips: single query location for an end-date check?

**No.** Timed rule-generated trips are loaded through **multiple unrelated paths**:

| Query location | Select shape | Includes `rule_id` | Includes rule `end_date` |
|----------------|--------------|--------------------|---------------------------|
| `trips-listing.tsx` (RSC) | Full list query for Fahrten | Yes (in `*`) | No |
| `tripsService.getTrips()` | `select('*')` | Yes | No |
| `use-unplanned-trips` / `fetchUnplannedTrips` | `select('*, requested_date')` | Yes | No |
| `client-trips-panel` | Explicit column list incl. `rule_id` | Yes | No |
| `getTripById` | Trip embeds, no rule embed | Yes | No |
| Cron | `recurring_rules` + trips insert | N/A (server) | Yes (server-side only today) |

Adding expiry warnings **per timed trip row** would require either **enriching each path** (high maintenance) or a **shared rule metadata map** (one rules query + client-side join on `rule_id`).

---

## 5. Existing Notification Patterns

### Persistent inline warnings (not toasts)

| Pattern | File | Component | Notes |
|---------|------|-----------|--------|
| **shadcn `Alert`** (amber) | `shift-summary-bar.tsx` | `ShiftSummaryBar` | Conditional banner when unconfigured payers; `AlertTitle` + `AlertDescription`. Good template for dashboard-wide warning strip. |
| **shadcn `Alert`** (amber/blue) | `invoice-builder/step-2-params.tsx`, `step-3-line-items.tsx`, `step-4-confirm.tsx` | Step-level | Builder warnings, German copy. |
| **Row-level badge** | `pending-tours-widget.tsx` | `UnplannedTripRow` | `Badge variant='destructive'` + `AlertTriangle` when linked partner cancelled — **widget-local**, not page-level. |
| **Row icon** | `trips-tables/columns.tsx` | Time column | `RepeatIcon` for recurring — informational, not expiry. |
| **Auth/forms** | `sign-in-view.tsx`, etc. | `Alert variant='destructive'` | Error display, not operational warnings. |

**Dashboard overview** (`src/app/dashboard/overview/layout.tsx`):

- **No** global “alerts” or “notifications” region.
- Widgets: stats cards, `TimelessRuleTripsWidget`, `PendingToursWidget`, parallel-route charts.
- Errors: **toasts** in hooks (`useTimelessRuleTrips`, `useUnplannedTrips`) on load failure.

### Dedicated dashboard alerts section?

**No.** All operational hints today are **widget-local** (card description, row badges) or live on **other routes** (Regelfahrten table columns, client recurring list subtitle “bis dd.MM.yyyy”).

There is **no** `recurringKeys` / rules query key family in `src/query/keys/`; Regelfahrten relies on **RSC + `router.refresh()`** after mutations.

---

## 6. Senior Recommendation

### Problem shape

Recurring work splits into:

1. **Timeless rule legs** — dashboard widget, `scheduled_at` null, tight date window.
2. **Timed rule legs** — Fahrten list/kanban/unplanned mix with all other trips.
3. **Rule metadata** — `end_date` + `is_active` live on **`recurring_rules`**, not on trips.

Expiry is a **rule-level** fact. Trips are **occurrence-level**. Trying to infer “expires tomorrow” only from trip queries will miss rules with no rows in the timeless window and will duplicate logic across Fahrten, Kanban, and unplanned paths.

### Recommended architecture: **(d) rule-centric query + dashboard banner, optional row hints**

**Primary surface (maintainability):**

1. Add a **small dedicated data source** (hook or RSC helper) that queries **`recurring_rules`** once:
   - `is_active = true`
   - `end_date IS NOT NULL`
   - `end_date = tomorrowYmd` (Berlin, same helpers as timeless widget)
   - Optional: `start_date <= tomorrowYmd` (ignore not-yet-started rules)
   - Select: `id`, `client_id`, `end_date`, `pickup_address`, `dropoff_address`, client name embed (mirror `getAllRules` embeds for display).

2. Render **one persistent `Alert` banner** at the top of **`/dashboard/overview`** (above stats/widgets), German copy e.g.  
   *“1 Regelfahrt endet morgen (04.06.2026). Letzte geplante Serie-Tage prüfen.”*  
   Link to **`/dashboard/regelfahrten`** (filtered/sorted by `end_date` later) or client Stammdaten.

   - Reuse **`ShiftSummaryBar` / invoice-builder** amber `Alert` styling for consistency.
   - TanStack key e.g. `['recurring-rules', 'expiring', tomorrowYmd]` — parallel to `tripKeys.timelessRuleTrips`, documented in `src/query/keys/` (new `recurring.ts` or extend reference keys).

**Why not (c) notification badge only:** no global notification system exists; a badge without a list duplicates Regelfahrten and hides actionable context (which passenger/route ends).

**Secondary (optional, lower priority):**

- **(b) Inline on timeless rows:** if banner lists rule IDs, map `pair.outbound?.rule_id` / `pair.return?.rule_id` and show a small amber `Badge` “Regel endet morgen” on matching pairs — helps dispatchers tying expiry to **tomorrow’s** Zeitabsprache work.
- **Regelfahrten:** highlight row when `end_date === tomorrow` (table already has `end_date` column) — zero new query on that page.

**Avoid as primary approach:**

- **(b) only on Fahrten rows** — too many query entry points; timed recurring trips are not isolated.
- **Frontend-only from current timeless/unplanned responses** — insufficient data (`end_date` missing).

### Cron / semantics alignment

Cron already stops generating occurrences after `end_date` (inclusive end-of-day Berlin). The alert should mean: **“after tomorrow’s calendar day, cron will not create new legs”** — dispatchers should finish Zeitabsprache / plan last rides. Clarify in copy that **existing timed trips after `end_date`** may still exist until manually cancelled (series cancel sets `is_active: false` and cancels pending future trips — separate action).

### German UI convention

Follow existing labels: **“Gültig bis”**, **“Regelfahrten”**, **“Wiederkehrende Trips”** (widget title). Prefer **“Regel endet morgen”** over English “expiry”.

### Implementation order (when building)

1. `fetchExpiringRecurringRules(tomorrowYmd)` + query key + overview banner.
2. Timeless widget row badge (join by `rule_id` from banner set or embed `end_date` once in timeless query).
3. Regelfahrten row highlight (RSC already has full rule rows).
4. Defer Fahrten/Kanban per-row badges unless product insists — use banner + Regelfahrten as source of truth.

---

## Appendix — Key file index

| Topic | Path |
|-------|------|
| Timeless hook | `src/features/dashboard/hooks/use-timeless-rule-trips.ts` |
| Timeless widget | `src/features/dashboard/components/timeless-rule-trips-widget.tsx` |
| Trip type | `src/features/trips/api/trips.service.ts` |
| Query keys | `src/query/keys/trips.ts`, `src/query/keys/index.ts` |
| Rules service / server | `src/features/trips/api/recurring-rules.service.ts`, `recurring-rules.server.ts` |
| Regelfahrten UI | `src/app/dashboard/regelfahrten/page.tsx`, `src/features/recurring-rules/components/` |
| Cron end_date | `src/app/api/cron/generate-recurring-trips/route.ts` |
| Schema types | `src/types/database.types.ts` (`recurring_rules`, `trips.rule_id`) |
| Overview layout | `src/app/dashboard/overview/layout.tsx` |
| Prior audits | `docs/plans/recurring-rules-audit.md`, `docs/plans/timeless-rule-trips-audit.md`, `docs/features/recurring-rules-overview.md` |
