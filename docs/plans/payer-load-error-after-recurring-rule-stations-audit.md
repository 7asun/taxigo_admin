# Payer load error after recurring-rule stations rollout — audit

**Status:** Investigation complete (findings only — no code changes)  
**Date:** 2026-06-19  
**Symptom:** UI shows  
`Fehler beim Laden — Die Kostenträger konnten nicht geladen werden. Bitte versuchen Sie es später erneut.`  
**Related feature:** `recurring_rules_station_enabled` + recurring-rule station columns (`20260618120000_recurring_rules_stations.sql`)

---

## Executive summary

The error copy is rendered exclusively on the **Kostenträger admin page** when the TanStack Query behind `usePayers()` fails. That query now **SELECTs `payers.recurring_rules_station_enabled`**. If the deployed app points at a Supabase database where migration `20260618120000_recurring_rules_stations.sql` has **not** been applied, PostgREST rejects the query (typically `column payers.recurring_rules_station_enabled does not exist`, code `42703`), and the page shows the generic failure state.

This matches the plan’s explicit deployment constraint: **DB-first is safe; UI-before-DB is not.**

**Recommended fix:** Apply the migration to the live Supabase project **before** (or immediately alongside) the app build that includes the new SELECT. **Do not patch app code** until the column exists in the target database.

---

## 1. Exact query path for this error message

### UI surface

| Item | Location |
|------|----------|
| Error title | `Fehler beim Laden` |
| Error body | `Die Kostenträger konnten nicht geladen werden. Bitte versuchen Sie es später erneut.` |
| Component | [`src/features/payers/components/payers-page.tsx`](../src/features/payers/components/payers-page.tsx) L67–77 |
| Condition | `usePayers()` returns `error` (TanStack Query `isError`) |

### Call chain (end to end)

```
/dashboard/payers
  └─ src/app/dashboard/payers/page.tsx          (auth gate only; no payer fetch)
       └─ PayersPage
            └─ usePayers()                       src/features/payers/hooks/use-payers.ts L29–33
                 queryKey: ['payers']
                 queryFn: PayersService.getPayers()
            └─ PayersService.getPayers()         src/features/payers/api/payers.service.ts L43–57
                 supabase.from('payers').select(
                   '…, recurring_rules_station_enabled, billing_types(count)'
                 )
            └─ on PostgREST error → toQueryError(error) → thrown → TanStack Query `error`
            └─ payers-page.tsx renders generic German failure copy (does not surface `error.message`)
```

### Notes on this path

- The page is **client-side**; the RSC wrapper only checks session (`page.tsx` L11–18).
- Failures are **swallowed in the UI**: the user never sees the underlying PostgREST message (e.g. missing column). DevTools → Network (request to `/rest/v1/payers?select=…`) or console (`Error fetching payers:` from `getPayers` L53) would show the real error.
- Invalidation after payer edits uses the same `['payers']` key (`use-payers.ts` L57–59, `payer-details-sheet.tsx` after toggle saves).

---

## 2. Every `payers` SELECT touched by `recurring_rules_station_enabled`

Only **two read paths** were updated to **SELECT** the new column:

| # | Function | File | Select fragment (relevant) | Consumers |
|---|----------|------|----------------------------|-----------|
| 1 | `PayersService.getPayers()` | [`src/features/payers/api/payers.service.ts`](../src/features/payers/api/payers.service.ts) L45–49 | `…, revision_invoices_enabled, recurring_rules_station_enabled, billing_types(count)` | `usePayers()` → **Kostenträger page**, `PayerDetailsSheet` cache, [`filter-bar.tsx`](../src/features/unassigned-trips/components/filter-bar.tsx) (direct service call) |
| 2 | `fetchPayers()` | [`src/features/trips/api/trip-reference-data.ts`](../src/features/trips/api/trip-reference-data.ts) L28–35 | `…, reha_schein_enabled, recurring_rules_station_enabled` | `usePayersQuery()` → `useTripFormData()`, recurring-rule forms, trip create/filter pickers, [`timeless-rule-trips-widget.tsx`](../src/features/dashboard/components/timeless-rule-trips-widget.tsx) |

### Related WRITE (not SELECT, but same column dependency)

| Function | File | Operation |
|----------|------|-----------|
| `updatePayerRecurringRulesStationEnabled()` | [`src/features/payers/api/payers.service.ts`](../src/features/payers/api/payers.service.ts) L530–539 | `UPDATE payers SET recurring_rules_station_enabled = …` |

Used by the new **Stationen (Daueraufträge)** switch in [`payer-details-sheet.tsx`](../src/features/payers/components/payer-details-sheet.tsx) L655+. This would also fail on a DB without the column (user could not save the toggle).

### `payers` SELECTs **not** changed (unaffected by missing column)

These queries do **not** reference `recurring_rules_station_enabled` and would keep working even if the migration is missing:

| File | Select |
|------|--------|
| `src/app/dashboard/invoices/page.tsx` L25–28 | `id, name` |
| `src/app/dashboard/invoices/new/page.tsx` | (lightweight payer list — no new column) |
| `src/app/dashboard/invoices/[id]/edit/page.tsx` | (lightweight payer list — no new column) |
| `src/features/invoices/api/invoice-text-blocks.api.ts` L245–256 | text-block joins only |
| `src/features/invoices/api/pdf-vorlagen.api.ts` | (payer assignment — no new column in grep) |
| `src/features/invoices/components/text-block-form.tsx` L149 | (payer picker — no new column) |

No evidence of a **missed SELECT** that should include the column but does not. The two intentional read paths were updated together.

---

## 3. Does the app SELECT the column on a DB that may not have it yet?

**Yes — by design of the rollout, and this is the most likely root cause.**

| Evidence | Detail |
|----------|--------|
| Migration exists locally | [`supabase/migrations/20260618120000_recurring_rules_stations.sql`](../supabase/migrations/20260618120000_recurring_rules_stations.sql) adds `payers.recurring_rules_station_enabled boolean not null default false` |
| App code requires column at query time | Both `getPayers()` and `fetchPayers()` include it in `.select(...)` |
| Types assume column exists | [`src/types/database.types.ts`](../src/types/database.types.ts) L772, L787, L802; [`Payer`](../src/features/payers/types/payer.types.ts) L104; [`PayerOption`](../src/features/trips/types/trip-form-reference.types.ts) L19 |
| Plan constraint | DB-first safe; UI-before-DB fails on read/write of new columns |

If production/staging Supabase was **not** migrated before the app was deployed, **every** call to `getPayers()` or `fetchPayers()` fails at PostgREST. The Kostenträger page is the most visible because it treats query failure as a full-page error.

**Expected PostgREST error (typical):**

- Message: `column payers.recurring_rules_station_enabled does not exist`
- Code: `42703`

---

## 4. Missed query paths / type–select mismatches

### Runtime query paths

- **No missed SELECT** for the new column on the two payer-list loaders above.
- **Two separate caches**, both updated in feature code:
  - Admin: `queryKey: ['payers']` (`use-payers.ts`)
  - Reference: `referenceKeys.payers()` → `['reference', 'payers']` (`use-trip-reference-queries.ts`)
  - Both underlying fetchers include the new column.

### TypeScript vs runtime shape

| Type | Expects `recurring_rules_station_enabled` | Loaded by |
|------|-------------------------------------------|-----------|
| `Payer` / `PayerWithBillingCount` | `boolean` (required) | `getPayers()` — **selected** ✓ |
| `PayerOption` | `boolean` (required) | `fetchPayers()` — **selected** ✓ |

There is **no** third code path that returns `Payer`/`PayerWithBillingCount`/`PayerOption` without going through one of the two updated selects. So there is **no type/select mismatch** in the sense of “TypeScript expects the field but query omits it.”

If the query **succeeds** after migration, runtime shape matches types. If the query **fails** (missing column), the object is never returned — the page shows the generic error instead.

### Documentation drift (not a runtime bug)

[`src/query/README.md`](../src/query/README.md) L39 still describes `referenceKeys.payers()` as slim `id, name, kts_default` only. The live `fetchPayers()` select also includes `no_invoice_required_default`, `reha_schein_enabled`, and now `recurring_rules_station_enabled`. This is stale docs, not the load failure.

---

## 5. Smallest safe fix

### If the live DB is missing the column (most likely)

**Do not change app code yet.**

1. Apply migration to the target Supabase project:
   - File: `supabase/migrations/20260618120000_recurring_rules_stations.sql`
   - Adds `payers.recurring_rules_station_enabled` and `recurring_rules.pickup_station` / `dropoff_station`
2. Verify in SQL editor:
   ```sql
   SELECT recurring_rules_station_enabled FROM payers LIMIT 1;
   ```
3. Optionally regenerate types: `bun run db:types` (types were manually patched during implementation when local Supabase was unavailable).
4. Reload `/dashboard/payers` — `usePayers()` should succeed without redeploy.

This preserves existing behaviour for all payers (`default false`) and unblocks both read paths and the payer toggle UPDATE.

### If migration is already applied and error persists

Then the cause is **not** the missing column. Next checks (outside this rollout’s default explanation):

1. Browser Network tab: inspect failed `GET …/rest/v1/payers?select=…` response body (RLS, auth, other schema drift).
2. Console: `Error fetching payers:` log from `getPayers()` includes normalized message via `toQueryError`.
3. Confirm the app’s `NEXT_PUBLIC_SUPABASE_URL` points at the same project where the migration was applied.

No broad refactor recommended.

### Defensive fallback in app code?

**Not recommended as the primary fix** when the DB lacks the column:

| Approach | Why not |
|----------|---------|
| Remove column from SELECT until migrated | Hotfix only; hides deployment mistake; station feature stays broken on recurring forms |
| Try/catch and default `recurring_rules_station_enabled: false` | Masks PostgREST failure; Kostenträger page would still fail if `billing_types(count)` embed fails for another reason; adds branching in two fetchers |
| Feature flag to skip column | Over-engineering; migration is the intended fix |

**Where a fallback would live (only if product requires UI-before-DB hotfix):**

- `PayersService.getPayers()` and/or `fetchPayers()` — catch `42703`, retry with legacy select and map `recurring_rules_station_enabled: false`.

**Why that is worse than migrating:** violates the plan guardrail, duplicates select strings, and recurring-rule station gating would silently stay off until a proper deploy.

---

## Secondary impact map (same root cause, different UX)

| Surface | Path | User-visible symptom if column missing |
|---------|------|----------------------------------------|
| `/dashboard/payers` | `usePayers()` → `getPayers()` | **Full-page error** (reported bug) |
| Recurring rule forms | `useTripFormData()` → `fetchPayers()` | Payer dropdown empty / loading; forms still render but billing section degraded |
| Trip create / filters | `usePayersQuery()` | Same as above |
| Dashboard timeless widget | `fetchPayers()` for filter | Payer filter query fails (widget may still show trips) |
| Unassigned trips filter | `PayersService.getPayers()` in `useEffect` | Silent — `console.error` only (`filter-bar.tsx` L36–37) |
| Payer details toggle | `updatePayerRecurringRulesStationEnabled` | Toast “Speichern fehlgeschlagen” if user flips **Stationen (Daueraufträge)** |

---

## Verification checklist (for operator)

- [ ] Confirm migration `20260618120000_recurring_rules_stations.sql` applied on the Supabase project the app uses
- [ ] Confirm column exists: `\d payers` or `information_schema.columns`
- [ ] Reload `/dashboard/payers` — list loads
- [ ] Open recurring rule form — payer select populates
- [ ] Optional: flip **Stationen (Daueraufträge)** on a payer — save succeeds

---

## Conclusion

| Question | Answer |
|----------|--------|
| Exact error path? | `PayersPage` → `usePayers()` → `PayersService.getPayers()` SELECT including `recurring_rules_station_enabled` |
| SELECTs touched? | Two: `getPayers()`, `fetchPayers()`; one UPDATE for toggle |
| SELECT on DB without column? | **Yes** — expected failure if UI-before-DB |
| Missed query / type mismatch? | **No** missed SELECT; types align with the two updated fetchers |
| Smallest safe fix? | **Apply migration to live DB; do not change app code first** |
