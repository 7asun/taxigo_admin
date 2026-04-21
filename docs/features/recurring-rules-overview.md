# Alle Regelfahrten (overview)

Cross-client list of recurring trip rules at **`/dashboard/regelfahrten`**: dispatchers see every rule with Fahrgast, schedule, addresses, Rückfahrt, billing, and status in one sortable, filterable table. Row links still go to Fahrgast Stammdaten (`/dashboard/clients/[id]`) for editing existing rules; **new** rules can be created from this page (see **Create flow** below).

**Architecture:** The RSC page loads data with [`getAllRules`](../../src/features/trips/api/recurring-rules.server.ts) (server Supabase client), applies guest filter, sort, and pagination slice from URL search params (same manual-table contract as Fahrten), then passes one page of rows into a client [`RecurringRulesOverview`](../../src/features/recurring-rules/components/recurring-rules-overview.tsx) that uses `useDataTable` + `DataTable` + `DataTableToolbar`.

## Create flow

- **Entry:** **Neue Regelfahrt** in the table toolbar (right side, same slot pattern as `DataTableToolbar` children elsewhere).
- **Sheet (two steps):**
  1. **Fahrgast wählen** — searchable list (debounced browser Supabase query; empty query shows an alphabetical browse slice). **Weiter** moves on only after a row is selected.
  2. **Regel** — same fields and validation as [`RecurringRuleSheet`](../../src/features/clients/components/recurring-rule-sheet.tsx) via shared [`RecurringRuleFormBody`](../../src/features/clients/components/recurring-rule-form-body.tsx). **Zurück** returns to step 1 without closing the Sheet; **Hinzufügen** calls `recurringRulesService.createRule`.
- **After success:** toast `Regel erfolgreich erstellt`, Sheet closes, **`router.refresh()`** re-runs the RSC page so `getAllRules()` returns the new row (no TanStack list key for this table — same idea as [`client-form.tsx`](../../src/features/clients/components/client-form.tsx) after save).

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
| [`src/config/nav-config.ts`](../../src/config/nav-config.ts) | Top-level nav item **Regelfahrten** after **Fahrten**. |

If `tsc` or the bundler pulls the server module into the client bundle when columns `import type` from `recurring-rules.server.ts`, extract **`src/features/recurring-rules/types/recurring-rules-overview.types.ts`** with only `RecurringRuleWithClientEmbed` and point server + columns at it (see implementation plan — no other workaround).

## Deferred

- Edit recurring rules inline from this overview (rows still deep-link to the client page).
- Active/inactive and date-range filters on the toolbar.
- `recurring_rules` RLS policies (migration task).
- Server-side pagination beyond URL page slice when row counts grow.

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

## Known gaps

RLS on `recurring_rules` is not defined in tracked migrations; behaviour on production depends on the live DB. See [recurring-rules-overview-audit.md](../plans/recurring-rules-overview-audit.md).
