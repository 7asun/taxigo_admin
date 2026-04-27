# Audit: Trip Cancellation — Driver Reset + Print Exclusion

## Implementation status

**Implemented:** 2026-04-27 — Admin/dispatcher cancels clear `driver_id`; driver cancel uses `cancel_trip_as_driver` RPC; Fahrtenplan ZIP query excludes `cancelled`; see [trip-linking-and-cancellation.md](../trip-linking-and-cancellation.md) and [print-trips-export.md](../print-trips-export.md).

---

**Scope (historical audit snapshot):** Original read-only audit of behavior before the implementation above. Some findings below are superseded; kept for traceability.

**Primary references:**

- Trip row type: `Trip` = `Database['public']['Tables']['trips']['Row']` in `src/features/trips/api/trips.service.ts`
- Status labels/colors: `src/lib/trip-status.ts`
- Cancellation behavior overview: `docs/trip-linking-and-cancellation.md`
- Print / ZIP export: `docs/print-trips-export.md`

---

## 1. Cancel handler — driver field

**Finding:** **`driver_id` is not cleared on cancel anywhere in the audited paths.** Updates set `status` (and usually `canceled_reason_notes` or appended `notes`) only.

**Dispatcher / admin UI** (via `src/features/trips/api/recurring-exceptions.actions.ts`):

- Single / paired non-recurring:

```111:117:src/features/trips/api/recurring-exceptions.actions.ts
  const { error } = await supabase
    .from('trips')
    .update({
      status: 'cancelled',
      canceled_reason_notes: reason ?? trip.canceled_reason_notes ?? null
    })
    .eq('id', trip.id);
```

- Recurring occurrence skip (and paired leg): same pattern — `.update({ status: 'cancelled', canceled_reason_notes: ... })` without `driver_id`.

- Cancel recurring series (bulk future `pending` trips):

```276:284:src/features/trips/api/recurring-exceptions.actions.ts
  const { error: timedError } = await supabase
    .from('trips')
    .update({
      status: 'cancelled',
      canceled_reason_notes: reason ?? null
    })
    .eq('rule_id', trip.rule_id)
    .gte('scheduled_at', new Date().toISOString())
    .eq('status', 'pending');
```

(and the parallel update for `scheduled_at IS NULL` / `requested_date` — still no `driver_id`.)

**Driver portal:**

```192:195:src/features/driver-portal/api/driver-trips.service.ts
  const { error } = await supabase
    .from('trips')
    .update({ status: 'cancelled', notes: updatedNotes })
    .eq('id', tripId);
```

**Conclusion:** No mutation today explicitly sets `driver_id: null` (or any equivalent) when cancelling.

---

## 2. Cancel handler — completeness

**Finding:** Cancellation is implemented in **two backend layers** (dispatcher actions vs driver service), invoked from **several UI entry points**.

| Entry point | Mechanism |
| ----------- | --------- |
| Trip detail sheet | `useTripCancellation()` → `recurring-exceptions.actions.ts` (`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`) |
| Trips data table row actions | Same hook (`src/features/trips/components/trips-tables/cell-action.tsx`) |
| Client trips panel | Same hook (`src/features/trips/components/client-trips-panel.tsx`) |
| Driver portal trip card | `cancelTrip` from `src/features/driver-portal/api/driver-trips.service.ts` (`src/features/driver-portal/components/shared/driver-trip-card.tsx`) |

**Orchestration:** `src/features/trips/hooks/use-trip-cancellation.ts` branches on mode (`single-nonrecurring`, `cancel-nonrecurring-and-paired`, `skip-occurrence`, `skip-occurrence-and-paired`, `cancel-series`) and calls the corresponding functions in `recurring-exceptions.actions.ts`. It does **not** use `useMutation`; it uses `useState` for loading and direct `async` calls, then invalidates queries / refreshes the router.

**No separate bulk-cancel mutation** was found beyond **cancel recurring series**, which bulk-updates many rows in SQL filters.

---

## 3. Supabase schema

**Finding:**

- **Column name:** The assigned driver FK on `public.trips` is **`driver_id`** (nullable UUID, FK to `accounts` per generated types and references like `trips_driver_id_fkey`).
- **Not** `fahrer_id` in this schema.
- **Generated TypeScript** (`src/types/database.types.ts`): `trips.Row.driver_id` is `string | null`; `Insert`/`Update` allow `driver_id?: string | null`. That indicates **no NOT NULL constraint** on `driver_id` at the type level (consistent with nullable assignment and existing code that sets `driver_id` to `null` elsewhere, e.g. Fremdfirma flows, bulk upload).
- **Migrations in-repo** are mostly `ALTER TABLE` on `trips`; the baseline `CREATE TABLE trips` was not re-audited from an initial migration file in this pass, but **nothing in the generated types suggests `driver_id` is required**.

---

## 4. Plan / print component — trip filtering

**Finding:** **Cancelled trips are not excluded** from the Fahrten drucken / ZIP flow.

**Data load** (`src/features/trips/components/print-trips-button.tsx`):

- Client Supabase query: `trips` with `scheduled_at` between `startOfDay` and `endOfDay` (ISO range), ordered by `scheduled_at`.
- **No** `.neq('status', 'cancelled')` or equivalent.
- Embeds `driver` and `billing_variant` only.

Trips are then:

- Passed through `buildColumns` / `buildItemsByColumn` (same Kanban grouping helpers),
- Grouped by `trip.driver?.name || 'Nicht zugewiesen'` for per-driver PDFs,
- Rendered via `MobilePrintTemplate`, `BoardOverviewPrintTemplate`, and `BoardLandscapeOnlyPrintTemplate`.

**Partial filtering that exists:** Overview columns drop the **`unassigned`** column and only keep drivers with at least one trip — but **stornierte Fahrten with a non-null `driver_id` still count** and remain in each driver’s list. There is **no** status-based exclusion.

**Note:** Trips with `scheduled_at IS NULL` are **outside** this query’s window and do not appear in print for that day at all (separate from cancellation).

---

## 5. PDF renderer

**Finding:** The plan is **not** produced with `@react-pdf/renderer`.

**Actual pipeline** (see `docs/print-trips-export.md`):

1. React templates: `MobilePrintTemplate`, `BoardOverviewPrintTemplate`, `BoardLandscapeOnlyPrintTemplate` (DOM / Tailwind-style layout).
2. **JPEG snapshots** via `html-to-image` (`toJpeg`).
3. **jsPDF** (`jspdf`) embeds the JPEG for per-driver PDFs; ZIP bundles PDFs + overview JPEGs.

**Entry component:** `PrintTripsButton` → `generatePrintouts` in `src/features/trips/components/print-trips-button.tsx`.

There is **no** `window.print()` in this flow for the ZIP export.

---

## 6. Status field values

**Finding:**

- **Database / row type:** `trips.status` is typed as **`string`** on the generated `Trip` row (not a DB enum in the TypeScript schema).
- **Application “canonical” union** for UI and documentation: `TripStatus` in `src/lib/trip-status.ts`:

  `'completed' | 'assigned' | 'scheduled' | 'in_progress' | 'driving' | 'cancelled' | 'pending' | 'open'`

- **Cancellation value** used in all audited updates: **`'cancelled'`** (English), with German label **„Storniert“** in `tripStatusLabels`.
- **Driver portal** constants map `CANCELLED: 'cancelled'` in `src/features/driver-portal/types/trips.types.ts`.

There is **no** `storniert` string as the stored `status` value in the audited code paths — UI copy uses German; DB value is `cancelled`.

---

## 7. RLS / permissions

**Finding:** Policies on `public.trips` (from `supabase/migrations/20260409170000_add_missing_rls.sql`, recreated in `20260409180000_fix_rls_helper_recursion.sql`):

- **`trips_update_company_admin`:** Admins may update rows in their company; **`WITH CHECK`** only enforces admin + `company_id` — **does not** require `driver_id` to stay non-null. Admins can set `driver_id` to `NULL` in principle.
- **`trips_update_own_driver`:** Drivers may update rows where **`driver_id = auth.uid()`**, and **`WITH CHECK (driver_id = auth.uid())`** requires the **new** row to still have `driver_id` equal to the authenticated user.

**Implication for “null driver on cancel”:**

- If a **driver** cancels via the portal and the update were extended to **`driver_id: null`**, the post-update row would **not** satisfy `driver_id = auth.uid()`. The **`WITH CHECK`** on `trips_update_own_driver` would **block** that update (unless the policy is changed or cancellation uses a `SECURITY DEFINER` RPC).
- **Admin/dispatcher** cancellations using the same session as company admin typically hit **`trips_update_company_admin`** and are **not** blocked by the driver policy for clearing `driver_id`.

---

## 8. Senior recommendation

**Goals:** (a) Clear `driver_id` when a trip is cancelled; (b) Exclude cancelled trips from the print/ZIP pipeline — without breaking lists, stats, or other readers.

**(a) Nulling `driver_id` on cancel**

1. **Centralize the write shape** in one place if possible: extend every `.update({ status: 'cancelled', ... })` in `recurring-exceptions.actions.ts` to also set **`driver_id: null`** (and mirror for paired-leg updates). For **`cancelRecurringSeries`**, the bulk updates should include **`driver_id: null`** alongside `status: 'cancelled'` so future cancelled materializations do not retain stale assignment.
2. **Driver portal:** Either:
   - **Option A (recommended for clarity):** Add a small **`SECURITY DEFINER`** RPC (e.g. `cancel_trip_as_driver`) that sets `status`, notes, and `driver_id = NULL` under validation that the caller was the assigned driver **before** the update; or
   - **Option B:** Relax **`trips_update_own_driver`** `WITH CHECK` to allow `(driver_id IS NULL AND status = 'cancelled')` — narrower than full nulling permission but requires careful policy review so drivers cannot null themselves on active trips.
3. **Fremdfirma / external assignment:** Trips with **`fremdfirma_id` set** often already use **`driver_id: null`** in business logic; setting `driver_id: null` on cancel remains consistent. Confirm no code assumes “cancelled ⇒ still has driver for display” beyond print (grep before shipping).
4. **Low risk to lists/stats:** Trip list and filters already treat **`cancelled`** as a first-class status (filters, badges, kanban side counts). Clearing **`driver_id`** may move cancelled rows out of “assigned to driver X” filters — that is usually **desirable** for accuracy (driver should not appear as still holding a cancelled leg). Watch **dashboard widgets** that combine `driver_id` + status (e.g. unassigned / pending counts); cancelled rows should continue to be excluded where the query already uses `status not in (cancelled, completed)`.

**(b) Excluding cancelled trips from print**

1. **Lowest risk, localized change:** In `print-trips-button.tsx`, add **`.neq('status', 'cancelled')`** (or `.not('status', 'eq', 'cancelled')` per Supabase client style) to the trips query **alongside** the existing `scheduled_at` range filter. That affects **only** the ZIP export, not the main trips page.
2. **Optional defense-in-depth:** Filter `trips` array (or `KanbanTrip[]` passed to `buildColumns`) with `status !== 'cancelled'` so any future query change cannot resurrect cancelled rows in print.
3. **Consistency:** Kanban board UI already **hides** cancelled cards from the main columns while showing a count (`kanban-board.tsx`); aligning print with that product expectation reduces confusion without changing database state.

**Testing / rollout:** Verify driver-cancel path against RLS; verify admin cancel + paired/recurring paths; spot-check a day with mixed cancelled/active trips in ZIP; confirm shift-reconciliation or other features that join on `driver_id` still behave if cancelled trips lose assignment (likely positive).
