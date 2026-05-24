# Driver Planning — `updated_at` Upsert & Read Fetch Pattern Audit

**Date:** 2026-05-24  
**Mode:** Read-only findings (no code or plan changes)  
**Scope:** How the codebase sets `updated_at` on Supabase JS writes, and how React Query hooks fetch data — to inform `driver_day_plans.upsertDayPlan` and `useDriverWeekPlan`.

---

## 1. `updated_at` on upsert / update via Supabase JS client

### Database-layer pattern (migrations read)

There is **no** Postgres trigger, `moddatetime` extension, or `handle_updated_at()` function anywhere in `supabase/migrations/`. Tables with `updated_at` rely on **`DEFAULT now()` at INSERT** and **application code at UPDATE**.

| Source | What it says / does |
| --- | --- |
| [`supabase/migrations/20260408120001_pdf_vorlagen.sql`](supabase/migrations/20260408120001_pdf_vorlagen.sql) **54–56** | Comment: *"updated_at maintained by the application on UPDATE."* Column: `updated_at timestamptz NOT NULL DEFAULT now()` |
| [`supabase/migrations/20260505180000_manual_km_overrides_foundation.sql`](supabase/migrations/20260505180000_manual_km_overrides_foundation.sql) **80–81** | Comment on `client_km_overrides.updated_at`: *"Application must set this on every UPDATE."* |
| [`supabase/migrations/20260411120000_storno_atomic_rpc.sql`](supabase/migrations/20260411120000_storno_atomic_rpc.sql) **135–139** | SQL `UPDATE` inside RPC: `updated_at = now()` (server-side SQL, not JS client) |
| [`supabase/migrations/20260505180000_manual_km_overrides_foundation.sql`](supabase/migrations/20260505180000_manual_km_overrides_foundation.sql) **215–219** | Same RPC pattern (redefined function): `updated_at = now()` |

**Note:** [`shift_reconciliations`](supabase/migrations/20260428120000_shift_reconciliations.sql) has **no** `updated_at` column — only `confirmed_at`.

---

### Supabase JS `.upsert()` examples (entire `src/**`)

Only **three** call sites use `.upsert()` on Supabase tables:

| File | Lines | `updated_at` in payload? | Notes |
| --- | --- | --- | --- |
| [`src/features/company-settings/api/company-settings.api.ts`](src/features/company-settings/api/company-settings.api.ts) | **138–147** | **Yes** — `updated_at: new Date().toISOString()` | Closest match for `driver_day_plans` upsert: single payload applied on insert **and** on conflict update |
| [`src/features/shift-reconciliations/api/shift-reconciliations.service.ts`](src/features/shift-reconciliations/api/shift-reconciliations.service.ts) | **245–256** | **No** — table has no `updated_at`; uses `confirmed_at: new Date().toISOString()` instead | Admin upsert via server Supabase client |
| [`src/lib/tracking/use-driver-tracking.ts`](src/lib/tracking/use-driver-tracking.ts) | **84–95** | **Yes** — `updated_at: new Date().toISOString()` | Browser client upsert on `live_locations` |

**`company-settings.api.ts` (upsert with `updated_at`):**

```ts
// lines 138–147
const { data, error } = await supabase
  .from('company_profiles')
  .upsert(
    {
      company_id: companyId,
      ...payload,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'company_id' }
  )
```

**`shift-reconciliations.service.ts` (upsert without `updated_at`):**

```ts
// lines 245–256
const { error } = await supabase.from('shift_reconciliations').upsert(
  {
    company_id: companyId,
    driver_id: params.driverId,
    date: params.date,
    confirmed_by: userId,
    confirmed_at: new Date().toISOString(),
    notes: params.notes?.trim() ? params.notes.trim() : null,
    shift_id: shiftId
  },
  { onConflict: 'company_id,driver_id,date' }
);
```

**`use-driver-tracking.ts` (upsert with `updated_at`):**

```ts
// lines 84–95
const { error: upsertError } = await supabase.from(TRACKING_TABLE).upsert(
  {
    driver_id: driverId,
    company_id: companyId,
    lat: coords.latitude,
    lng: coords.longitude,
    speed_kmh,
    accuracy_m,
    updated_at: new Date().toISOString()
  },
  { onConflict: 'driver_id' }
);
```

---

### Supabase JS `.update()` examples that set `updated_at`

The codebase **always sets `updated_at` explicitly** on `.update()` for tables documented as application-maintained. Two styles appear:

**Style A — inline `new Date().toISOString()`:**

| File | Lines |
| --- | --- |
| [`src/features/invoices/api/pdf-vorlagen.api.ts`](src/features/invoices/api/pdf-vorlagen.api.ts) | **172–173** (patch object), **250**, **257** |
| [`src/features/invoices/api/client-km-overrides.api.ts`](src/features/invoices/api/client-km-overrides.api.ts) | **119–121** |
| [`src/features/trips/api/trip-presets.service.ts`](src/features/trips/api/trip-presets.service.ts) | **101–103** |
| [`src/features/payers/api/billing-pricing-rules.api.ts`](src/features/payers/api/billing-pricing-rules.api.ts) | **326–328** |
| [`src/features/payers/api/client-price-tags.service.ts`](src/features/payers/api/client-price-tags.service.ts) | **202–204** |
| [`src/features/invoices/api/invoice-text-blocks.api.ts`](src/features/invoices/api/invoice-text-blocks.api.ts) | **164–168**, **223** |
| [`src/features/angebote/api/angebote.api.ts`](src/features/angebote/api/angebote.api.ts) | **406**, **441** |
| [`src/features/angebote/api/angebot-vorlagen.api.ts`](src/features/angebote/api/angebot-vorlagen.api.ts) | **138–139**, **201**, **208** |
| [`src/features/invoices/api/invoices.api.ts`](src/features/invoices/api/invoices.api.ts) | **377** |

**Style B — `const now = new Date().toISOString()` reused in the same operation:**

| File | Lines |
| --- | --- |
| [`src/features/invoices/api/invoices.api.ts`](src/features/invoices/api/invoices.api.ts) | **340**, **352** |
| [`src/features/trips/api/trip-presets.service.ts`](src/features/trips/api/trip-presets.service.ts) | **125**, **130** |
| [`src/features/clients/api/clients-pricing.api.ts`](src/features/clients/api/clients-pricing.api.ts) | **53**, **59**, **83** |
| [`src/features/angebote/api/angebot-vorlagen.api.ts`](src/features/angebote/api/angebot-vorlagen.api.ts) | **101**, **110** (insert) |
| [`src/features/invoices/api/pdf-vorlagen.api.ts`](src/features/invoices/api/pdf-vorlagen.api.ts) | **135** (insert `updated_at: now`) |

**`letters.api.ts`** builds updates via helper with `updated_at` first:

| File | Lines |
| --- | --- |
| [`src/features/letters/api/letters.api.ts`](src/features/letters/api/letters.api.ts) | **72–74** (`toUpdateRow`) |

---

### Examples that **omit** `updated_at` on update

| File | Lines | Context |
| --- | --- | --- |
| [`src/features/shift-reconciliations/api/shift-reconciliations.service.ts`](src/features/shift-reconciliations/api/shift-reconciliations.service.ts) | **207–210** | `updateTripManualPrice` — `.update({ manual_gross_price: manualGrossPrice })` only; `trips.updated_at` not touched |

This is intentional (narrow field write); it is **not** the pattern for tables whose migration comments require app-maintained `updated_at` (e.g. `client_km_overrides`, `pdf_vorlagen`).

---

### Does any upsert use `new Date().toISOString()` for `updated_at`?

**Yes — two upserts:**

1. [`src/features/company-settings/api/company-settings.api.ts`](src/features/company-settings/api/company-settings.api.ts) **144**
2. [`src/lib/tracking/use-driver-tracking.ts`](src/lib/tracking/use-driver-tracking.ts) **92**

**No upsert omits `updated_at` on a table that has the column** except where the column does not exist (`shift_reconciliations`).

Inserts often set `updated_at` explicitly too (e.g. pdf-vorlagen **135**, angebot-vorlagen **110**), but on INSERT the DB `DEFAULT now()` would also suffice; the important invariant is **updates must set it** because there is no trigger.

---

### Conclusion for `driver_day_plans.upsertDayPlan`

**Match the `company_profiles` upsert pattern** in [`company-settings.api.ts`](src/features/company-settings/api/company-settings.api.ts) **138–147**:

- Include **`updated_at: new Date().toISOString()`** (or a local `const now = new Date().toISOString()` reused in the payload) **inside the `.upsert()` object** so it applies on both initial INSERT and `ON CONFLICT DO UPDATE`.
- Do **not** rely on a DB trigger (none exists in this repo).
- Do **not** omit `updated_at` on the conflict-update path (would leave stale timestamp after first insert).
- INSERT-only default `now()` is insufficient alone for upsert semantics; explicit `updated_at` in the payload is the established JS-client approach for upsert-on-conflict.

**Recommended shape (illustrative, not implementation):**

```ts
const now = new Date().toISOString();
await supabase.from('driver_day_plans').upsert(
  {
    company_id: companyId,
    driver_id: payload.driverId,
    plan_date: payload.planDate,
    status: payload.status,
    planned_start: payload.plannedStart ?? null,
    planned_end: payload.plannedEnd ?? null,
    vehicle_id: payload.vehicleId ?? null,
    notes: payload.notes ?? null,
    created_by: userId, // set on insert; harmless on update or omit from update set if preferred
    updated_at: now
  },
  { onConflict: 'company_id,driver_id,plan_date' }
);
```

Aligns with migration intent (same family as `pdf_vorlagen` / `client_km_overrides` comments) and the only admin **upsert** precedent that touches `updated_at`.

---

## 2. Server actions for reads (React Query `queryFn`)

### `use-shift-day-summaries.ts`

[`src/features/shift-reconciliations/hooks/use-shift-day-summaries.ts`](src/features/shift-reconciliations/hooks/use-shift-day-summaries.ts) **20–22**:

```ts
return useQuery<ShiftDaySummary[]>({
  queryKey: shiftReconciliationKeys.summaries(driverId ?? '__none__'),
  queryFn: () => getShiftDaySummariesAction(driverId!),
  enabled,
  ...
});
```

- Imports `getShiftDaySummariesAction` from [`../actions`](src/features/shift-reconciliations/actions.ts) (**47–50**), a **`'use server'`** wrapper that delegates to `getShiftDaySummaries()` in the service.
- Does **not** call the service directly.
- Does **not** use a route handler.

### Other hooks in `shift-reconciliations` (same feature — server-only service)

| Hook file | queryFn / mutationFn | Server action |
| --- | --- | --- |
| [`use-shift-trips.ts`](src/features/shift-reconciliations/hooks/use-shift-trips.ts) **22** | `queryFn: () => getShiftTripsForDateAction(driverId!, date!)` | Yes |
| [`use-shift-reconciliation.ts`](src/features/shift-reconciliations/hooks/use-shift-reconciliation.ts) **24** | `queryFn: () => getShiftReconciliationRecordAction(driverId!, date!)` | Yes |
| [`use-confirm-shift.ts`](src/features/shift-reconciliations/hooks/use-confirm-shift.ts) **13–14** | `mutationFn: ... confirmShiftReconciliationAction(params)` | Yes (mutation) |
| [`use-update-trip-price.ts`](src/features/shift-reconciliations/hooks/use-update-trip-price.ts) **18** | `updateTripManualPriceAction(...)` | Yes (mutation) |

**Why this feature uses actions:** [`shift-reconciliations.service.ts`](src/features/shift-reconciliations/api/shift-reconciliations.service.ts) imports `createClient` from [`@/lib/supabase/server`](src/lib/supabase/server.ts) (**13**) and runs `requireAdminContext()` — **server-only**. Client components cannot import it safely.

[`actions.ts`](src/features/shift-reconciliations/actions.ts) **1–7** documents the boundary: *"Thin server-action boundary … Delegates only to shift-reconciliations.service"*.

### Contrast: other React Query hooks in the repo (not shift-reconciliations)

Some features call **API/service modules directly** because those modules use the **browser** Supabase client:

| Hook | queryFn | Service client |
| --- | --- | --- |
| [`use-trips.ts`](src/features/trips/hooks/use-trips.ts) **27** | `() => tripsService.getTrips()` | Browser / shared service |
| [`use-pdf-vorlagen.ts`](src/features/invoices/hooks/use-pdf-vorlagen.ts) **26** | `() => listPdfVorlagen(companyId)` | [`pdf-vorlagen.api.ts`](src/features/invoices/api/pdf-vorlagen.api.ts) uses `@/lib/supabase/client` **11** |
| [`use-payers.ts`](src/features/payers/hooks/use-payers.ts) **31** | `() => PayersService.getPayers()` | Browser service |

**No route handlers** were found as React Query `queryFn` targets in `src/features/**/hooks/*.ts`.

[`use-upcoming-trips.ts`](src/features/trips/hooks/use-upcoming-trips.ts) (required read) is **not** TanStack Query — it uses `useState` + `useEffect` and calls `tripsService.getUpcomingTrips()` directly (**66**), plus browser `createClient()` for Realtime (**104**).

---

### Conclusion for `useDriverWeekPlan`

**Use a `'use server'` read action — `getDriverWeekPlanAction` — as the `queryFn`, matching the shift-reconciliations feature exactly.**

Rationale:

1. **Planned `driver-planning.service.ts`** follows the same architecture as `shift-reconciliations.service.ts`: `createClient()` from `@/lib/supabase/server` + local `requireAdminContext()`. Client hooks must not import it.
2. **All five** shift-reconciliation React Query hooks (reads and mutations) go through [`actions.ts`](src/features/shift-reconciliations/actions.ts); reads are not special-cased to call the service directly.
3. **RSC prefetch** on the page can call `getDriverWeekPlan()` from the service directly (same as [`shift-reconciliations/page.tsx`](src/app/dashboard/shift-reconciliations/page.tsx) calling `getShiftDaySummaries()` **56** server-side) while the client hook uses the action for refetch/cache updates.

**Do not** call `driver-planning.service.ts` directly from `useDriverWeekPlan`.  
**Do not** add a route handler for reads unless the project pattern changes globally.

**Expected hook shape (illustrative):**

```ts
queryFn: () => getDriverWeekPlanAction(driverId!, weekStartYmd),
```

with `getDriverWeekPlanAction` in [`actions.ts`](src/features/driver-planning/actions.ts) delegating to `getDriverWeekPlan()` in the service — mirroring [`getShiftDaySummariesAction`](src/features/shift-reconciliations/actions.ts) **47–50**.

---

*End of audit.*
