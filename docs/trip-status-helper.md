# Trip status helper – driver assignment behavior

This document describes the **`getStatusWhenDriverChanges`** helper and when to use it so trip status stays in sync with driver assignment across the app.

---

## What it does

**File:** `src/features/trips/lib/trip-status.ts`

The helper answers: *“Given the trip’s current status and the new `driver_id` we’re about to save, should we also change the status?”*

It returns the **status value to set** when driver assignment changes, or `undefined` when no status change is needed.

### Behavior

| Current status | New `driver_id` | Return value |
|----------------|-----------------|--------------|
| `pending` (Offen) | set to a driver (non‑null) | `'assigned'` (Zugewiesen) |
| `assigned` (Zugewiesen) | set to `null` (unassign) | `'pending'` (Offen) |
| Any other status | any | `undefined` (no change) |

So:

- **Assigning a driver** to a trip that is “Offen” → status should become “Zugewiesen”.
- **Unassigning the driver** from a trip that is “Zugewiesen” → status should become “Offen”.
- Other statuses (e.g. `in_progress`, `completed`, `cancelled`) are left unchanged.

---

## When to use it

Use this helper **whenever you update a trip’s `driver_id`** so that status and driver stay consistent. Typical cases:

1. **Table:** Admin changes the driver in the list (e.g. `DriverSelectCell`).
2. **Kanban:** Admin drags a trip into a driver column and saves.
3. **Create / edit form:** User selects a driver when creating or editing a trip.
4. **API routes or server actions:** Any endpoint that sets or clears `driver_id` on a trip.
5. **Bulk updates:** Assigning or unassigning drivers for multiple trips.

If you add a new UI or API that updates `driver_id`, call this helper and send the returned status in the same update when it is not `undefined`.

---

## How to use it

```ts
import { getStatusWhenDriverChanges } from '@/features/trips/lib/trip-status';

// When building the payload to update a trip:
const newDriverId = value === 'unassigned' ? null : value; // or from form/API

const payload: { driver_id: string | null; status?: string } = {
  driver_id: newDriverId
};

const derivedStatus = getStatusWhenDriverChanges(trip.status, newDriverId);
if (derivedStatus) payload.status = derivedStatus;

// Then send payload to Supabase / tripsService.updateTrip / etc.
```

- **Create flow:** For a new trip, use current status `'pending'` and the chosen `driver_id`; use the returned status (or `'pending'`) as the initial trip status.
- **Update flow:** Use the trip’s current `status` and the new `driver_id`; if the helper returns a value, include it in the update so the stored status stays in sync.

---

## Where it’s used in this project

| Location | Usage |
|----------|--------|
| `src/features/trips/components/trips-tables/driver-select-cell.tsx` | On driver change in the table: builds update payload with `driver_id` and optional `status` from the helper, then updates one trip or all trips in the same group. |
| `src/features/trips/components/trips-kanban-board.tsx` | On “Speichern”: for each pending change, if only `driver_id` was set (e.g. drag to driver column), uses the helper to set `status` so assigned trips become “Zugewiesen”. |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | When creating a trip: initial status is `getStatusWhenDriverChanges('pending', driverId) ?? 'pending'`, so trips created with a driver start as “Zugewiesen”. |

---

## Why a shared helper

- **One place** for the rule “assign driver → Zugewiesen, unassign → Offen”, so behavior is the same everywhere.
- **Easier to extend** later (e.g. different rules for certain statuses or roles) without touching every caller.
- **Consistent UX:** List, Kanban, and create form all reflect the same status after driver changes.

For more on trip filtering and URL state, see [trips-filters-bar.md](trips-filters-bar.md).
