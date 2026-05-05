# Plan C implementation log — recurring rule coordinate stabilisation

## Completed steps

1. **Migration** — [`supabase/migrations/20260505120000_add-coords-to-recurring-rules.sql`](../../supabase/migrations/20260505120000_add-coords-to-recurring-rules.sql): nullable `FLOAT8` columns `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` with `IF NOT EXISTS`.
2. **Types** — [`src/types/database.types.ts`](../../src/types/database.types.ts): same four columns on `recurring_rules` Row / Insert / Update.
3. **Geocode helper** — [`src/lib/geocode-rule-addresses.ts`](../../src/lib/geocode-rule-addresses.ts): `Promise.allSettled`, `[plan-c]` logs, never throws.
4. **Server actions** — [`src/features/trips/api/recurring-rules.actions.ts`](../../src/features/trips/api/recurring-rules.actions.ts): `'use server'`, Supabase server client, geocode on create; on update prefetch row and geocode only when `pickup_address` or `dropoff_address` **string** differs from existing.
5. **UI** — [`create-recurring-rule-sheet.tsx`](../../src/features/recurring-rules/components/create-recurring-rule-sheet.tsx), [`recurring-rule-sheet.tsx`](../../src/features/clients/components/recurring-rule-sheet.tsx), [`recurring-rule-panel.tsx`](../../src/features/clients/components/recurring-rule-panel.tsx) call server actions. **`grep`** confirmed billing pricing hooks (`use-billing-pricing-rules`, `use-all-pricing-rules`) expose unrelated **`createRule`/`updateRule`** for pricing rules — **no** recurring-rule changes needed there.
6. **Browser service** — [`recurring-rules.service.ts`](../../src/features/trips/api/recurring-rules.service.ts): removed **`createRule`** / **`updateRule`** after migration.
7. **Cron** — [`generate-recurring-trips/route.ts`](../../src/app/api/cron/generate-recurring-trips/route.ts): exception address overrides → live geocode only; full stored coords on rule → clone live structured geocode then override lat/lng (`mergeLegCoords`); return legs swap stored coords; **`geoCache`** stores only unmodified `resolveGeoLine` results.

## `updateRule` approach

**Prefetch + string compare** inside **`updateRecurringRule`**: load existing row by id when the payload may include addresses; geocode only if pickup or dropoff **text** changed vs DB. Matches full-form submits without relying on `'pickup_address' in payload`.

## Cron coordinate approach

Always **`resolveGeoLine`** both legs for structured trip columns and cache population. **`mergeLegCoords`** applies stable rule coordinates **after** live resolve, on **cloned** objects — overridden results are **not** written to **`geoCache`** (avoids poisoning cache when an exception later uses the same string).

## Build / test gates

- `bun run build` — passed.
- `bun test` — 88 tests passed.

## Database

Apply migration locally/remotely with project workflow (e.g. `bunx supabase db push` or `npx supabase db push`) after pulling this branch. _(Not run in CI/agent here if Supabase CLI is unavailable.)_

## Deferred (explicitly out of scope)

- Option 2: Places Autocomplete lat/lng/`place_id` on rule form.
- `place_id` columns on `recurring_rules`.
- `recurring_rule_exceptions` stabilisation.
- SQL backfill for legacy rule coordinates.
- Plan B4 two-stage `route_metrics_cache` lookup.

---

_Completion: Plan C shipped as above._
