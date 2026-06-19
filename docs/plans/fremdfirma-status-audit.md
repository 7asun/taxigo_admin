# Fremdfirma Status Audit

Read-only audit of how trip `status` interacts with Fremdfirma assignment. No code changes.

**Date:** 2026-06-19  
**Project DB:** TaxiGo Admin Dashboard (`etwluibddvljuhkxjkxs`)

---

## 1. Status label mapping

### Where labels are defined

The canonical mapping from DB `trips.status` string → German display label lives in **`src/lib/trip-status.ts`**, exported as `tripStatusLabels`:

```ts
export const tripStatusLabels: Record<TripStatus, string> = {
  completed: 'Erledigt',
  assigned: 'Zugewiesen',
  scheduled: 'Geplant',
  in_progress: 'Unterwegs',
  driving: 'Unterwegs',
  cancelled: 'Storniert',
  pending: 'Offen',
  open: 'Offen'
};
```

Related exports in the same file:

- `TripStatus` — union of allowed status strings (includes legacy aliases `open`, `driving`)
- `tripStatusBadge` — CVA classes for badge/chip styling
- `tripStatusRow` — row tint classes for tables/lists

There is **no** dedicated `trip-status-badge.tsx` component. Status badges are rendered inline wherever needed, e.g.:

| Surface | File | Pattern |
|---------|------|---------|
| Fahrten table Status column | `src/features/trips/components/trips-tables/columns.tsx` | `tripStatusLabels[status]` + `tripStatusBadge({ status })` |
| Mobile card list | `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | same |
| Kanban card | `src/features/trips/components/kanban/kanban-trip-card.tsx` | same |
| Trip detail sheet header | `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `getStatusInfo(trip.status)` → `tripStatusLabels` + `tripStatusBadge` |

### Important: `pending` is **not** `'Nicht zugewiesen'`

| DB value | Display label (status badge) |
|----------|------------------------------|
| `'pending'` | **Offen** |
| `'open'` | **Offen** (legacy alias) |
| `'assigned'` | **Zugewiesen** |

**`'Nicht zugewiesen'`** is used for **assignee / driver** UI, not trip status:

- `TripAssigneeBadge` / `resolveTripAssignee` (`src/features/trips/lib/trip-assignee.ts`) — unassigned assignee label
- Driver select placeholder and “unassigned” option (`driver-select-cell.tsx`, trip detail sheet Fahrer select)
- Kanban unassigned column title (`kanban-columns.ts`)
- Fahrten filter “Nicht zugewiesen” (`trips-filters-bar.tsx`) — filters assignee, not `status`

The Fahrten **status** filter uses `'Offen'` for `pending` (`trips-filters-bar.tsx` statusOptions).

### DB column

`trips.status` is typed as `string` in `database.types.ts` (not a Postgres enum). Comments in `src/lib/trip-status.ts` document intended semantics:

- `pending` / `open` — created, no driver yet (admin kanban “Offen”)
- `assigned` — dispatcher has assigned a driver (admin flow)

---

## 2. Fremdfirma assignment in `trip-fremdfirma-section.tsx`

### Update path

All saves go through `persist()` → `tripsService.updateTrip(trip.id, patch)`.

Payload is built by `applyFremdfirmaPayload`:

```ts
const applyFremdfirmaPayload = (next: {
  fremdfirma_id: string | null;
  fremdfirma_payment_mode: FremdfirmaPaymentMode | null;
  fremdfirma_cost: number | null;
}) => {
  const payload: Record<string, unknown> = {
    fremdfirma_id: next.fremdfirma_id,
    fremdfirma_payment_mode: next.fremdfirma_payment_mode,
    fremdfirma_cost: next.fremdfirma_cost,
    driver_id: next.fremdfirma_id ? null : trip.driver_id,
    needs_driver_assignment: next.fremdfirma_id
      ? false
      : !(trip.driver_id ?? null)
  };
  const derived = getStatusWhenDriverChanges(
    trip.status,
    next.fremdfirma_id ? null : (trip.driver_id ?? null),
    { fremdfirmaId: next.fremdfirma_id }
  );
  if (derived) payload.status = derived;
  return payload;
};
```

### Does it ever set `status: 'assigned'` explicitly?

**No.** It never hard-codes `status: 'assigned'`. Status is included **only** when `getStatusWhenDriverChanges` returns a non-undefined value.

### Example payload when assigning a Fremdfirma (from `pending`, no driver)

When user toggles Fremdfirma on and saves (e.g. single vendor auto-save):

```ts
{
  fremdfirma_id: '<uuid>',
  fremdfirma_payment_mode: 'monthly_invoice' | 'self_payer' | ...,
  fremdfirma_cost: number | null,
  driver_id: null,
  needs_driver_assignment: false
  // status: OMITTED — not included in payload
}
```

### Walk-through: `getStatusWhenDriverChanges` for Fremdfirma assign

Inputs:

- `currentStatus = 'pending'`
- `newDriverId = null` (Fremdfirma path passes null because external assignee clears internal driver)
- `options.fremdfirmaId = '<some-uuid>'`

Current implementation (`src/features/trips/lib/trip-status.ts`):

```ts
export function getStatusWhenDriverChanges(
  currentStatus: string,
  newDriverId: string | null,
  options?: { fremdfirmaId?: string | null }
): string | undefined {
  if (newDriverId != null && newDriverId !== '') {
    if (currentStatus === 'pending') return 'assigned';
    return undefined;
  }
  if (
    !isTripUnassignedForDispatch({
      driver_id: null,
      fremdfirma_id: options?.fremdfirmaId ?? null
    })
  ) {
    return undefined;
  }
  if (currentStatus === 'assigned') return 'pending';
  return undefined;
}
```

Step-by-step:

1. `newDriverId` is null → skip assign branch (which would return `'assigned'` for `pending`).
2. `isTripUnassignedForDispatch({ driver_id: null, fremdfirma_id: '<uuid>' })` → **false** (Fremdfirma is set).
3. Function returns **`undefined`** — no status change.

**Result:** Fremdfirma assignment from `pending` leaves `status` as `'pending'` in the DB. This is a **logic gap**: the helper only promotes `pending → assigned` when `newDriverId` is non-null; Fremdfirma assignment deliberately passes `newDriverId = null`.

---

## 3. Unassignment path

When Fremdfirma is removed (`handleToggleFremd` with `on = false` and existing `trip.fremdfirma_id`):

```ts
applyFremdfirmaPayload({
  fremdfirma_id: null,
  fremdfirma_payment_mode: null,
  fremdfirma_cost: null
})
```

Payload:

```ts
{
  fremdfirma_id: null,
  fremdfirma_payment_mode: null,
  fremdfirma_cost: null,
  driver_id: trip.driver_id,           // unchanged
  needs_driver_assignment: !(trip.driver_id ?? null)  // true when no internal driver
}
```

Status derivation:

- `getStatusWhenDriverChanges(trip.status, trip.driver_id ?? null, { fremdfirmaId: null })`
- If trip had `status = 'assigned'`, no driver, Fremdfirma cleared → `isTripUnassignedForDispatch` true → returns **`'pending'`** ✓
- If trip had `status = 'pending'` already → returns **`undefined`** (no change) ✓

**Unassignment correctly reverts `assigned → pending`** when there is no internal driver left.

**`needs_driver_assignment`:** Set to `true` when Fremdfirma is removed and `trip.driver_id` is null. Set to `false` when Fremdfirma is assigned.

---

## 4. Trip detail sheet status display

### Component

**`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`**

Header badge (lines ~1122–1123):

```tsx
<Badge className={getStatusInfo(trip.status).class}>
  {getStatusInfo(trip.status).label}
</Badge>
```

`getStatusInfo` reads **`trip.status` directly** from the loaded DB row:

```ts
const getStatusInfo = (status: string) => {
  const s = status as TripStatus;
  return {
    label: (tripStatusLabels[s] ?? status).toUpperCase(),
    class: tripStatusBadge({ status: s })
  };
};
```

There is **no** render-time derivation from `fremdfirma_id` / `driver_id` for the status badge.

### Fahrer vs status (separate fields)

The **Fahrer** select (same sheet) shows `'Nicht zugewiesen'` when `driver_id` is null; it is **disabled** when `trip.fremdfirma_id` is set. That is assignee UI, not the status badge.

### If `status = 'pending'` but `fremdfirma_id` is set

| UI element | What user sees |
|------------|----------------|
| Status badge (header) | **OFFEN** (`pending` → `tripStatusLabels.pending`) |
| Fahrer select | **Nicht zugewiesen** (disabled; no internal driver) |
| Fremdfirma section | Fremdfirma on, partner/mode shown |

The sheet does **not** show **Zugewiesen** unless `trip.status === 'assigned'`.

---

## 5. Recurring trip generator

**File:** `src/lib/recurring-trip-generator.ts`

When the recurring rule has `fremdfirma_id`:

```ts
const hasFremdfirma = !!rule.fremdfirma_id;

...(hasFremdfirma
  ? {
      driver_id: null,
      needs_driver_assignment: false,
      status: 'assigned' as const
    }
  : { status: 'pending' as const }),
```

**Generated trips from Fremdfirma rules correctly get `status: 'assigned'`.** This path does not use `getStatusWhenDriverChanges`; it sets status explicitly.

The bug affects **manual** Fremdfirma assignment via the trip detail sheet, not cron-generated recurring trips (assuming rule had `fremdfirma_id` at generation time).

---

## 6. Existing trips in the DB

Queries run against production project `etwluibddvljuhkxjkxs` on 2026-06-19.

### Fremdfirma + `pending`

```sql
SELECT COUNT(*)
FROM trips
WHERE fremdfirma_id IS NOT NULL
  AND status = 'pending';
```

**Result: 10**

### Fremdfirma + `assigned`

```sql
SELECT COUNT(*)
FROM trips
WHERE fremdfirma_id IS NOT NULL
  AND status = 'assigned';
```

**Result: 8**

### Breakdown by status and `needs_driver_assignment`

| status | needs_driver_assignment | count |
|--------|-------------------------|-------|
| pending | false | 10 |
| assigned | false | 8 |

All 18 Fremdfirma trips have `needs_driver_assignment = false` (assignment flag was updated correctly). Only **`status`** is wrong on the 10 `pending` rows — consistent with the `applyFremdfirmaPayload` / `getStatusWhenDriverChanges` gap, not a failure to clear the dispatch flag.

No other status values appear among Fremdfirma-assigned trips in this snapshot.

---

## 7. Senior recommendation

### Root cause: **logic gap (primary), UI reflects DB faithfully (secondary)**

| Layer | Verdict |
|-------|---------|
| **`getStatusWhenDriverChanges`** | Does not handle “Fremdfirma assigned, driver cleared, was pending” → should become `assigned`. Returns `undefined` when `fremdfirmaId` is set and `newDriverId` is null. |
| **`applyFremdfirmaPayload`** | Relies entirely on that helper; never sets `status: 'assigned'` for Fremdfirma-only assignment. |
| **Status badge UI** | Not a separate rendering bug — it shows **Offen** because DB has `pending`. Users expecting **Zugewiesen** are seeing correct mapping of incorrect data. |
| **Assignee UI** | Correctly shows no internal driver (`Nicht zugewiesen` / Extern · name) while Fremdfirma is set — orthogonal to status badge. |

**Both** matter for UX: fix the write path so `status` matches “externally assigned”, and optionally consider whether status labels should ever be assignee-aware (not required if DB is fixed).

### Comparison with recurring generator

`recurring-trip-generator.ts` already implements the intended rule: **Fremdfirma ⇒ `status: 'assigned'`, `needs_driver_assignment: false`, `driver_id: null`**. Manual assignment should mirror that.

### Suggested fix direction (for a future plan — not implemented here)

1. **Write path:** Extend `getStatusWhenDriverChanges` (or add a sibling helper) so when `fremdfirmaId` is newly set and `currentStatus === 'pending'`, return `'assigned'`. Keep existing guard: when clearing driver but Fremdfirma remains, do not revert to `pending`.

   Alternatively, in `applyFremdfirmaPayload` only: if `next.fremdfirma_id && trip.status === 'pending'`, set `status: 'assigned'` explicitly (mirror recurring generator).

2. **Do not** change status badge to derive from `fremdfirma_id` unless product wants status and assignee decoupled long-term — fixing writes is simpler and matches recurring trips.

### Safest one-time migration for historical rows

Target rows that are externally assigned but still marked open:

```sql
-- Preview first:
SELECT id, status, fremdfirma_id, driver_id, needs_driver_assignment
FROM trips
WHERE fremdfirma_id IS NOT NULL
  AND status IN ('pending', 'open')
  AND driver_id IS NULL;

-- Fix (run as migration, not ad-hoc):
UPDATE trips
SET status = 'assigned'
WHERE fremdfirma_id IS NOT NULL
  AND status IN ('pending', 'open')
  AND driver_id IS NULL;
```

**Safety notes:**

- Predicate includes `driver_id IS NULL` so trips that somehow have both driver and Fremdfirma are not touched without review.
- `needs_driver_assignment` is already `false` on all 10 affected rows — no migration needed for that column.
- Include `'open'` for legacy alias parity with `TripStatus`.
- After migration, expect **18** Fremdfirma trips with `status = 'assigned'` (8 existing + 10 fixed) barring concurrent writes.

### Files to touch in a fix PR (reference)

| File | Why |
|------|-----|
| `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` | Write path (`applyFremdfirmaPayload`) |
| `src/features/trips/lib/trip-status.ts` | Shared status derivation |
| New migration SQL | Backfill 10 historical rows |
| Optional unit tests | `getStatusWhenDriverChanges` / Fremdfirma assign case |

---

## Appendix: Related types (`src/features/trips/types/`)

| File | Relevance |
|------|-----------|
| `trip-form-reference.types.ts` | `FremdfirmaOption`, `FremdfirmaPaymentMode` — reference data only, no status |
| `trip-row.ts` | List row shape with payer embed — no status logic |
| `trip-preset.types.ts` | Saved filter presets — no status assignment |
| `csv-export.types.ts` | Export config — out of scope |

Trip type itself is `Database['public']['Tables']['trips']['Row']` from `trips.service.ts` — includes `status`, `fremdfirma_id`, `driver_id`, `needs_driver_assignment`.
