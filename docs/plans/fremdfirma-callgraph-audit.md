# Fremdfirma Full Call-Graph & Data-Flow Audit

Read-only audit. No code changes.

**Date:** 2026-06-19  
**Scope:** Status logic, assignee abstraction, write paths, read/filter surfaces, controlling, dashboard, types.

---

## 1. Call graph tables

### 1.1 `getStatusWhenDriverChanges(currentStatus, newDriverId, options?)`

**Definition:** `src/features/trips/lib/trip-status.ts`

| # | File | Function / context | Arguments passed |
|---|------|-------------------|------------------|
| 1 | `trip-fremdfirma-section.tsx` | `applyFremdfirmaPayload` | `(trip.status, next.fremdfirma_id ? null : trip.driver_id, { fremdfirmaId: next.fremdfirma_id })` |
| 2 | `driver-select-cell.tsx` | `handleChange` | `(trip.status, newDriverId, { fremdfirmaId: trip.fremdfirma_id })` |
| 3 | `trip-detail-sheet.tsx` | `handleDriverChange` | `(trip.status, newDriverId, { fremdfirmaId: trip.fremdfirma_id })` |
| 4 | `pending-tours-widget.tsx` | `UnplannedTripRow.handleSetTime` | `(trip.status, driverId, { fremdfirmaId: trip.fremdfirma_id })` |
| 5 | `kanban-board.tsx` | `handleSave` (per staged change) | `(trip?.status ?? 'pending', change.driver_id, { fremdfirmaId: trip?.fremdfirma_id })` — only when `change.driver_id !== undefined` |
| 6 | `kanban-grouping.ts` | `deriveStatusForPending` | `(currentStatus, newDriverId, { fremdfirmaId: serverTrip?.fremdfirma_id })` |
| 7 | `create-trip-form.tsx` | submit `baseTrip` | `('pending', driverId)` — **no `fremdfirmaId`** |
| 8 | `create-trip-form.tsx` | anonymous / return leg inserts | `('pending', null)` — **no `fremdfirmaId`** |
| 9 | `build-return-trip-insert.ts` | `buildReturnTripInsert` | `('pending', params.driverId)` — **no `fremdfirmaId`** |
| 10 | `duplicate-trips.ts` | duplicate insert builder | `('pending', null)` — **no `fremdfirmaId`** |

**Callers that pass non-null `fremdfirmaId` today:** rows 1–6 when the trip (or `next` payload) has `fremdfirma_id` set. Purpose: when `newDriverId` is null, skip `assigned → pending` if the trip remains externally assigned.

**Callers that never pass `fremdfirmaId`:** create flow, return-trip builder, duplicate builder — none of these support Fremdfirma on insert today.

**Known gap:** row 1 passes `newDriverId = null` when assigning Fremdfirma; the function never returns `'assigned'` in that case (see status audit). Rows 7–10 cannot set Fremdfirma at all.

---

### 1.2 `isTripUnassignedForDispatch({ driver_id, fremdfirma_id })`

**Definition:** `src/features/trips/lib/trip-assignee.ts` — `true` only when both FKs are null.

| # | File | Usage | Object passed |
|---|------|-------|---------------|
| 1 | `trip-status.ts` | Inside `getStatusWhenDriverChanges` unassign branch | `{ driver_id: null, fremdfirma_id: options?.fremdfirmaId ?? null }` |
| 2 | `pending-tours-widget.tsx` | CardDescription `noDriver` count | Full trip row `t` from unplanned query |

**Surfaces that use it for render/count:** only **`pending-tours-widget.tsx`** (`ohne Fahrer` sub-count). `trip-status.ts` uses it internally for write derivation.

**Related but separate:** Supabase filters use raw `.is('driver_id', null).is('fremdfirma_id', null)` in `trips-listing.tsx`, `use-unplanned-trips.ts`, `use-pending-assignments.ts`, `debug-queries.ts` — not via this helper.

---

### 1.3 `isTripFremdfirma({ fremdfirma_id })`

| # | File | Usage |
|---|------|-------|
| 1 | `kanban-board.tsx` | Count hidden Fremdfirma trips; filter `visibleTrips` (exclude from board) |

---

### 1.4 `resolveTripAssignee(trip)`

**Definition:** `src/features/trips/lib/trip-assignee.ts`

| # | File | What it does with result |
|---|------|--------------------------|
| 1 | `driver-select-cell.tsx` | If `kind === 'fremdfirma'`, render `<TripAssigneeBadge />` and skip driver `<Select>` |
| 2 | `trips-mobile-card-list.tsx` | Render `<TripAssigneeBadge assignee={assignee} />` under date line |
| 3 | `print-trips-button.tsx` | Build PDF/ZIP group key: `Extern · ${label}` / driver label / `Nicht zugewiesen` |

**Not used (yet) in:** Fahrten status column, Kanban cards, trip detail sheet status badge, controlling charts, dashboard widgets.

---

### 1.5 Other `trip-assignee.ts` exports

| Export | Call sites |
|--------|------------|
| `parseAssigneeParam` | `trips-listing.tsx` (server filter) |
| `formatFremdfirmaAssigneeParam` | `trips-filters-bar.tsx` (dropdown option values) |
| `FREMDFIRMA_ALL_ASSIGNEE_PARAM` | `trips-filters-bar.tsx`, `kanban-board.tsx` (banner link) |
| `TripAssigneeBadge` | `driver-select-cell.tsx`, `trips-mobile-card-list.tsx` |

---

### 1.6 Inline assignee branching (bypasses `resolveTripAssignee`)

| File | Pattern | Notes |
|------|---------|-------|
| `trip-fremdfirma-section.tsx` | `!!trip.fremdfirma_id`, `trip.fremdfirma_id ?? ''` | Local form state sync |
| `trip-detail-sheet.tsx` | `disabled={... \|\| !!trip.fremdfirma_id}` on Fahrer select | Blocks driver edit when external |
| `columns.tsx` (`fremdfirma`, `fremdfirma_abrechnung`) | `row.original.fremdfirma_id`, `row.fremdfirma?.name` | Dedicated columns, not assignee column |
| `kanban-columns.ts` | `trip.driver_id ?? 'unassigned'` in `buildItemsByColumn` | Driver grouping only; Fremdfirma trips excluded upstream in board |
| `controlling-utils.ts` | `row.driver_id ?? '__unassigned__'` → label `Nicht zugewiesen` | Revenue by driver_id from RPC |
| `DriverRevenueChart.tsx` | Same via `aggregateDrivers` | Chart X-axis labels |
| `recurring-trip-generator.ts` | `hasFremdfirma = !!rule.fremdfirma_id` | Status on materialize |

No file uses the literal ternary `fremdfirma_id ? ... : driver_id ? ...` for display; assignee display is split between `resolveTripAssignee` (3 sites) and raw FK checks (above).

---

## 2. Mutation map

All DB writes ultimately go through `tripsService.updateTrip` / `createTrip` / `bulkCreateTrips` / direct Supabase `.update` in a few places.

### 2.1 Assign Fremdfirma (`trip-fremdfirma-section.tsx`)

| Field | Value |
|-------|-------|
| **Handler** | `handleToggleFremd(true)` (auto-save if 1 vendor) or `saveVendorAndMode()` → `persist(applyFremdfirmaPayload(...))` |
| **Payload** | `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`, `driver_id: null`, `needs_driver_assignment: false`, optional `status` |
| **`getStatusWhenDriverChanges`?** | Yes: `(trip.status, null, { fremdfirmaId: uuid })` → **`undefined`** from `pending` → **status omitted** |
| **Explicit status?** | No — **bug**: stays `pending` unless already `assigned` |

### 2.2 Remove Fremdfirma (`trip-fremdfirma-section.tsx`)

| Field | Value |
|-------|-------|
| **Handler** | `handleToggleFremd(false)` when `trip.fremdfirma_id` was set |
| **Payload** | `fremdfirma_id: null`, `fremdfirma_payment_mode: null`, `fremdfirma_cost: null`, `driver_id: trip.driver_id` (unchanged), `needs_driver_assignment: !trip.driver_id`, optional `status: 'pending'` if was `assigned` and no driver |
| **`getStatusWhenDriverChanges`?** | Yes: `(trip.status, trip.driver_id, { fremdfirmaId: null })` |
| **Explicit status?** | Only via derived |

### 2.3 Assign internal driver (`driver-select-cell.tsx`)

| Field | Value |
|-------|-------|
| **Handler** | `handleChange` → Supabase `.update` on `trips` (or by `group_id`) |
| **Payload** | `{ driver_id: uuid, status?: 'assigned' }` |
| **`getStatusWhenDriverChanges`?** | Yes: `(trip.status, newDriverId, { fremdfirmaId: trip.fremdfirma_id })` — cell not shown when Fremdfirma set |
| **Explicit status?** | Only via derived (`pending → assigned`) |

Same pattern in **`trip-detail-sheet.tsx`** `handleDriverChange` via `tripsService.updateTrip`.

### 2.4 Remove internal driver (`driver-select-cell.tsx` / detail sheet)

| Field | Value |
|-------|-------|
| **Payload** | `{ driver_id: null, status?: 'pending' }` if no Fremdfirma; **`status` omitted** if `fremdfirma_id` set |
| **`getStatusWhenDriverChanges`?** | Yes with `{ fremdfirmaId: trip.fremdfirma_id }` |

### 2.5 Create trip form (`create-trip-form.tsx`)

| Field | Value |
|-------|-------|
| **Handler** | Form submit → `tripsService.createTrip` / `bulkCreateTrips` |
| **Payload** | `driver_id`, `status: getStatusWhenDriverChanges('pending', driverId) ?? 'pending'`, **no Fremdfirma fields** |
| **Fremdfirma on create?** | **Not supported** in Neue Fahrt flow |

### 2.6 Recurring generator (`recurring-trip-generator.ts`)

| Field | Value |
|-------|-------|
| **Handler** | Cron/materialize insert |
| **When `rule.fremdfirma_id` set** | `driver_id: null`, `needs_driver_assignment: false`, **`status: 'assigned'`** (explicit) |
| **When no Fremdfirma** | `status: 'pending'` |
| **`getStatusWhenDriverChanges`?** | **No** |

### 2.7 Other write paths touching assignment/status

| Action | File | Assignment/status behavior |
|--------|------|---------------------------|
| Kanban save (driver column DnD) | `kanban-board.tsx` | Staged `driver_id` + derived `status`; Fremdfirma trips excluded from board input |
| Pending dispatch inbox assign | `use-pending-assignments.ts` | `{ driver_id, needs_driver_assignment: false }` — no status derivation |
| Pending tours widget save time+driver | `pending-tours-widget.tsx` | `scheduled_at`, `driver_id`, derived `status` + `fremdfirmaId` guard |
| Bulk CSV upload | `bulk-upload-dialog.tsx` | `driver_id`, `status: driverId ? 'assigned' : 'pending'`, `needs_driver_assignment` — **no Fremdfirma** |
| Duplicate trips | `duplicate-trips.ts` | Clears `driver_id`, `fremdfirma_id`, `status: 'pending'` |
| Return trip insert | `build-return-trip-insert.ts` | Clears Fremdfirma fields; `status` from driver only |
| Recurring exceptions / cancel | `recurring-exceptions.actions.ts` | Clears `driver_id` on cancel (comments say "Nicht zugewiesen") |
| KTS service | `kts.service.ts` | `updateTrip` for KTS fields only |
| Invoice write-back | `trip-write-back.ts` | Pricing/KTS patches, not assignee |
| Timeless rule widget | `timeless-rule-trips-widget.tsx` | **`scheduled_at` only** — no driver/status |

---

## 3. Status transition matrix (correct target semantics)

Derived from product intent (mirror `recurring-trip-generator`: external or internal assignee ⇒ `assigned`; truly unassigned ⇒ `pending`), independent of current buggy implementation.

| currentStatus | newDriverId | newFremdfirmaId | correct resultStatus |
|---------------|-------------|-----------------|----------------------|
| pending | set | null | **assigned** |
| pending | null | set | **assigned** |
| pending | null | null | **pending** (no change) |
| assigned | set | null | **assigned** (no change) |
| assigned | null | set | **assigned** (external takes over; driver cleared) |
| assigned | null | null | **pending** |
| assigned | same | null | **assigned** (no change) |

**Implementation today vs matrix:** only **`pending + null driver + Fremdfirma set → assigned`** is wrong (stays `pending`). Unassign paths and driver-assign paths match the matrix.

---

## 4. DB invariants (recommended)

1. **Mutual exclusion (write-time):** When `fremdfirma_id IS NOT NULL`, `driver_id` MUST be `NULL`. Enforced in `applyFremdfirmaPayload` and recurring generator; not a DB constraint.

2. **Dispatch flag:** When `fremdfirma_id IS NOT NULL`, `needs_driver_assignment` SHOULD be `false`. When both assignee FKs null and no driver, `needs_driver_assignment` SHOULD be `true` (unless CSV pending edge case).

3. **Status vs assignee (desired):** If `driver_id IS NOT NULL` OR `fremdfirma_id IS NOT NULL`, `status` SHOULD be `'assigned'` (admin workflow). Exception: in-progress/completed/cancelled terminal states are set by other flows.

4. **Not an invariant today:** `driver_id` and `fremdfirma_id` both non-null can exist historically if data was edited outside `applyFremdfirmaPayload`; `resolveTripAssignee` treats Fremdfirma as winning.

5. **Controlling RPC lag:** SQL `unassigned_trips` counts `driver_id IS NULL` **without** excluding Fremdfirma — overlaps with `fremdfirma_trips` metric (see §5).

---

## 5. Controlling — grouping and Fremdfirma trips

### Data source

- **`use-controlling-data.ts`** → parallel TanStack queries → **`controlling.service.ts`** → Supabase RPCs (`get_controlling_operational`, `get_controlling_breakdown`, heatmap, invoice KPIs, monthly revenue).
- **No shared trip hook**; all aggregates are server-side SQL.

### Operational flags (`OperationalFlags.tsx`)

- Uses `get_controlling_operational` aggregates via `aggregateOperationalRows`.
- **`unassigned_trips`:** SQL `COUNT(*) WHERE driver_id IS NULL` (non-cancelled) — **includes Fremdfirma trips**.
- **`fremdfirma_trips`:** SQL `COUNT(*) WHERE fremdfirma_id IS NOT NULL` — separate counter + `fremdfirma_cost`.
- A Fremdfirma trip with `driver_id = null` can increment **both** flags.

### Driver revenue chart / driver table

- **`get_controlling_breakdown`** groups by `t.driver_id` + joined `accounts` name only — **no `fremdfirma_id` dimension**.
- **`aggregateDrivers`** (`controlling-utils.ts`): key `row.driver_id ?? '__unassigned__'`, label **`Nicht zugewiesen`** when null.
- **Fremdfirma trip appearance:** rolls into **`Nicht zugewiesen`** driver bucket in breakdown/chart — **not** a Fremdfirma row, **not** per-company extern group.

### Payer / billing dimensions

- Grouped by payer/billing_type/variant — assignee type not modeled.

---

## 6. Dashboard widgets — Fremdfirma awareness

| Widget / hook | References `driver_id` / `fremdfirma_id` / `status` | Behavior |
|---------------|-----------------------------------------------------|----------|
| **`use-unplanned-trips.ts`** | Query filter on `driver_id`, `fremdfirma_id`, `status` | See predicate below |
| **`pending-tours-widget.tsx`** | Count via `isTripUnassignedForDispatch`; save via `getStatusWhenDriverChanges` + `fremdfirmaId` | Sub-count `ohne Fahrer` excludes Fremdfirma |
| **`use-trips.ts`** | Loads all trips (`select *`) for overview stats | No assignee-specific filter; cancelled excluded in utils |
| **`use-timeless-rule-trips.ts`** | Select includes `driver_id`; excludes cancelled/completed | Sets time only — no assignee mutation |
| **`timeless-rule-trips-widget.tsx`** | Displays rule trips | No Fremdfirma-specific UI |
| **`stats-utils.ts`** | `trip.status === 'cancelled'` only | Revenue/day filters |

### `use-unplanned-trips` exact predicate

```ts
.select(`*, requested_date, ${ASSIGNEE_JOIN_FRAGMENT}`)
.or('scheduled_at.is.null,and(driver_id.is.null,fremdfirma_id.is.null)')
.not('status', 'in', '("cancelled","completed")')
```

### Would `status = 'assigned'` + `fremdfirma_id` set appear in pending widget?

| `scheduled_at` | In unplanned query? | In `ohne Fahrer` count? |
|----------------|---------------------|-------------------------|
| **Set** | **No** — neither OR branch matches | N/A (not in list) |
| **Null** | **Yes** — matches `scheduled_at.is.null` | **No** — `isTripUnassignedForDispatch` is false |

So: **scheduled Fremdfirma-assigned trips disappear entirely** from the widget; **unscheduled** ones still appear in the list (even if `status = 'assigned'`) but do not inflate `ohne Fahrer`.

---

## 7. Filters and search in `/fahrten`

### Assignee filter (`trips-filters-bar.tsx` → `driver_id` URL param)

| Option | URL value | Server filter (`trips-listing.tsx` via `parseAssigneeParam`) |
|--------|-----------|---------------------------------------------------------------|
| Alle Fahrer | *(param deleted / `all`)* | No assignee filter |
| Nicht zugewiesen | `unassigned` | `driver_id IS NULL AND fremdfirma_id IS NULL` |
| Each internal driver | driver UUID | `driver_id = uuid` |
| Alle Fremdfirmen | `fremdfirma:all` | `fremdfirma_id IS NOT NULL` |
| Each Fremdfirma | `fremdfirma:<uuid>` | `fremdfirma_id = uuid` |

**One-click “all Fremdfirma trips”?** **Yes** — **Alle Fremdfirmen** in the Fahrer dropdown (post assignee-abstraction work).

### Status filter

| Option | URL `status` | Server |
|--------|--------------|--------|
| Alle Status | cleared | none |
| Offen | `pending` | `eq('status', 'pending')` |
| Zugewiesen | `assigned` | `eq('status', 'assigned')` |
| In Fahrt | `in_progress` | … |
| Abgeschlossen | `completed` | … |
| Storniert | `cancelled` | … |

**Gap:** Filtering **Zugewiesen** misses Fremdfirma trips stuck at **`pending`** status (10 rows in prod DB per status audit). Users should use **Alle Fremdfirmen** assignee filter instead until status backfill + write fix.

### Table display

- **Fahrer column:** `DriverSelectCell` → `resolveTripAssignee` / badge.
- **Fremdfirma / Abrechnung Fremdfirma columns:** separate embed columns (`fremdfirma`, `fremdfirma_payment_mode`).
- **Status column:** raw `trip.status` → `tripStatusLabels` (`pending` → **Offen**, not “Nicht zugewiesen”).

---

## 8. `trip-assignee.ts` — full contents and coverage

### Full file (114 lines)

```ts
// The three states a trip can be in from an assignee perspective.
// Using 'kind' not 'type' to avoid collision with TypeScript's type keyword.
export type TripAssignee =
  | { kind: 'driver'; id: string; label: string }
  | {
      kind: 'fremdfirma';
      id: string;
      label: string;
      paymentMode: string | null;
    }
  | { kind: 'unassigned'; label: 'Nicht zugewiesen' };

/** Parsed value of the overloaded `driver_id` URL search param. */
export type AssigneeFilterParam =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'driver'; id: string }
  | { kind: 'fremdfirma'; id: string }
  | { kind: 'fremdfirma_all' };

// ... parseAssigneeParam, formatFremdfirmaAssigneeParam,
// FREMDFIRMA_ALL_ASSIGNEE_PARAM, resolveTripAssignee,
// isTripUnassignedForDispatch, isTripFremdfirma
```

(See `src/features/trips/lib/trip-assignee.ts` in repo for exact implementation.)

### Exports

| Kind | Names |
|------|-------|
| Types | `TripAssignee`, `AssigneeFilterParam` |
| Functions | `parseAssigneeParam`, `formatFremdfirmaAssigneeParam`, `resolveTripAssignee`, `isTripUnassignedForDispatch`, `isTripFremdfirma` |
| Constants | `FREMDFIRMA_ALL_ASSIGNEE_PARAM` (`'fremdfirma:all'`) |

**Note:** There is no `TripAssigneeType` export — the discriminant is `TripAssignee['kind']`.

### Consistency

| Uses abstraction | Bypasses it |
|----------------|-------------|
| Listing filter, Fahrer column (partial), mobile cards, print grouping, Kanban hide, pending count | Status badge everywhere, Fremdfirma detail columns, controlling SQL, Kanban column buckets (driver_id), create form, CSV upload, detail sheet driver disable check |

### Missing for single source of truth

1. **`getStatusWhenAssignmentChanges`** — unified status derivation from `(currentStatus, currentAssignee, nextAssignee)` replacing driver-only helper.
2. **`buildAssigneeUpdatePayload`** — canonical write object for Fremdfirma assign/unassign/driver assign (fields + derived status).
3. **`assigneeGroupKey(trip)`** — for print, export, controlling client fallbacks (`Extern · name` / driver name / unassigned).
4. **`applyAssigneeFilterToQuery(query, filter)`** — server-side mirror of `parseAssigneeParam` (optional DRY for listing + future APIs).
5. **Status display helper** — optional `resolveTripDisplayStatus(trip)` if product wants badge to reflect assignee when `status` is stale (deferred unless write path cannot be fixed).

Join fragments live in **`trip-query-fragments.ts`** (`ASSIGNEE_JOIN_FRAGMENT`) — not re-exported from `trip-assignee.ts`.

---

## 9. Fremdfirma data — shape and availability

### Trip detail sheet

- **`useTripQuery` → `tripsService.getTripById`**
- Select string includes embed:  
  `fremdfirma:fremdfirmen(id, name, default_payment_mode)`  
  plus `driver:accounts!trips_driver_id_fkey(name)`.
- **Name comes from join**, not a separate client lookup. Fremdfirma **partner picklist** uses `useFremdfirmenQuery()` (reference cache).

### `/fahrten` table (list + kanban RSC)

- **`trips-listing.tsx`** uses `ASSIGNEE_JOIN_FRAGMENT` in both list and kanban selects.
- **Embedded** in same query as trip row — Fremdfirma name available on `row.fremdfirma.name`.

### Shared query / cache

| Query key / hook | Includes Fremdfirma embed? |
|------------------|----------------------------|
| `tripKeys.detail(id)` / `getTripById` | Yes |
| RSC `trips-listing` | Yes |
| `tripKeys.unplanned(filter)` | Yes (via `ASSIGNEE_JOIN_FRAGMENT`) |
| `useFremdfirmenQuery` / `referenceKeys.fremdfirmen()` | Fremdfirma **catalog**, not per-trip |
| `tripsService.getTrips()` (`tripKeys.all`) | **No** — `select('*')` only |
| `getUpcomingTrips` | **No** — driver + payer + billing only |
| Dispatch inbox `TRIP_FIELDS` | Partial — includes `FREMDFIRMA_JOIN_FRAGMENT` in select string |
| Controlling RPCs | Aggregate counts; breakdown uses `driver_id` only |

**Pattern:** Each surface defines its own select; **`ASSIGNEE_JOIN_FRAGMENT`** is the intended shared embed for assignee display, but not yet used everywhere.

---

## 10. `database.types.ts` — `trips` Row columns (full list)

Assignment/status-relevant columns called out; full Row from generated types:

`actual_dropoff_at`, `actual_pickup_at`, `billing_betreuer`, `billing_calling_station`, `billing_variant_id`, `kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`, `kts_handover_id`, `kts_patient_id`, `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, `kts_external_invoice_id`, `kts_source`, `kts_status`, `reha_schein`, **`fremdfirma_cost`**, **`fremdfirma_id`**, **`fremdfirma_payment_mode`**, `no_invoice_required`, `no_invoice_source`, `selbstzahler_collected_amount`, `client_id`, `client_name`, `client_phone`, `company_id`, `created_at`, `created_by`, **`driver_id`**, dropoff/pickup address + geo fields, `driving_distance_km`, `driving_duration_seconds`, `greeting_style`, `has_missing_geodata`, `group_id`, `id`, `ingestion_source`, `is_wheelchair`, `link_type`, `linked_trip_id`, `note`, `notes`, **`needs_driver_assignment`**, `canceled_reason_notes`, `payer_id`, `payment_method`, pricing fields (`net_price`, `gross_price`, `tax_rate`, …), `billing_type_id`, `requested_date`, `return_status`, `rule_id`, **`scheduled_at`**, **`status`**, `stop_order`, `stop_updates`, `vehicle_id`.

### `src/features/trips/types/`

| File | Role |
|------|------|
| `trip-form-reference.types.ts` | `FremdfirmaOption`, `FremdfirmaPaymentMode`, `DriverOption` — picker shapes |
| `trip-row.ts` | List row + payer embed |
| `trip-preset.types.ts` | Saved filter params (`driver_id` only) |
| `csv-export.types.ts` | Export columns — no assignee union |

### `src/features/fremdfirmen/types/`

**No dedicated types folder** — Fremdfirma admin uses service + `FremdfirmaOption` from trip reference types.

---

## 11. Recommended canonical model (signatures only)

Place in **`src/features/trips/lib/trip-assignee.ts`** (or split `trip-assignment.ts` if file grows):

```ts
// Types
export type TripAssignee = /* existing union */;
export type AssigneeFilterParam = /* existing */;
export type AssignmentPatchInput = {
  driver_id?: string | null;
  fremdfirma_id?: string | null;
  fremdfirma_payment_mode?: string | null;
  fremdfirma_cost?: number | null;
};

// Read / display
export function resolveTripAssignee(trip: TripAssigneeInput): TripAssignee;
export function assigneeGroupKey(trip: TripAssigneeInput): string;
export function isTripUnassignedForDispatch(trip: Pick<Trip, 'driver_id' | 'fremdfirma_id'>): boolean;
export function isTripFremdfirma(trip: Pick<Trip, 'fremdfirma_id'>): boolean;

// URL / query
export function parseAssigneeParam(driverIdParam: string | null | undefined): AssigneeFilterParam;
export function formatFremdfirmaAssigneeParam(fremdfirmaId: string): string;

// Write (new)
export function getStatusWhenAssignmentChanges(
  currentStatus: string,
  next: { driver_id: string | null; fremdfirma_id: string | null }
): string | undefined;

export function buildAssignmentPatch(
  current: Pick<Trip, 'status' | 'driver_id' | 'fremdfirma_id'>,
  next: AssignmentPatchInput
): Record<string, unknown>; // includes needs_driver_assignment + optional status
```

Move or re-export **`getStatusWhenDriverChanges`** as thin wrapper for backward compatibility, delegating to `getStatusWhenAssignmentChanges`.

---

## 12. Files that need change vs. simple consumers

### Need domain logic changes (assignment/status correctness)

| File | Why |
|------|-----|
| `trip-status.ts` / new assignment helper | Fix `pending → assigned` on Fremdfirma-only assign |
| `trip-fremdfirma-section.tsx` | Use shared `buildAssignmentPatch` |
| `supabase/.../controlling_rpcs.sql` (future) | Align `unassigned_trips` with dispatch definition |
| One-time migration | Backfill `status` for Fremdfirma rows (10× `pending` in prod) |

### Become simple consumers (call shared helpers only)

| File | After refactor |
|------|----------------|
| `driver-select-cell.tsx`, `trip-detail-sheet.tsx` | `buildAssignmentPatch` for driver changes |
| `pending-tours-widget.tsx` | Same for save |
| `kanban-board.tsx`, `kanban-grouping.ts` | Assignment status derivation |
| `trips-listing.tsx`, `trips-filters-bar.tsx` | Already on `parseAssigneeParam` |
| `print-trips-button.tsx`, mobile cards, `driver-select-cell` | Already on `resolveTripAssignee` |
| `use-unplanned-trips.ts`, `use-pending-assignments.ts` | Could use shared filter helper for null guards |

### Own logic that cannot be fully abstracted

| Area | Reason |
|------|--------|
| **Controlling RPCs** | Server-side aggregates; need SQL changes for Fremdfirma-aware `unassigned` and optional Fremdfirma breakdown dimension |
| **Driver portal** | Internal driver only — intentionally ignores Fremdfirma |
| **Recurring rule forms** | Rule-level Fremdfirma fields + generator explicit status |
| **Create trip / CSV import** | Separate product decisions to add Fremdfirma support |
| **Terminal statuses** | `in_progress`, `completed`, `cancelled` driven by driver app / cancel flows, not assignee helper |
| **Kanban status/payer grouping modes** | Group by `trip.status` or `payer_id` — assignee abstraction applies only to driver mode + filters |

---

## 13. Status label reference (for cross-audit clarity)

**File:** `src/lib/trip-status.ts`

| DB `status` | Label shown on status badge |
|-------------|----------------------------|
| `pending`, `open` | Offen |
| `assigned` | Zugewiesen |
| `in_progress`, `driving` | Unterwegs |
| `completed` | Erledigt |
| `cancelled` | Storniert |
| `scheduled` | Geplant |

**Assignee label “Nicht zugewiesen”** is separate (`trip-assignee.ts` / driver UI), not the same as status **Offen**.
