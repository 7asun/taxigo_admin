## 1. Invalidation Map

**Overall status: COMPLETE (v3 — enforcement active, 2026-06-23)**

From this point, any direct widget root invalidation outside `invalidate-after-trip-save.ts` will fail the lint check at commit time (`invalidation-contract/no-direct-widget-invalidation`).

Note: the requested paths `src/query-keys.ts`, `src/features/dashboard/widgets/pending-tours-widget.tsx`, `src/features/dashboard/widgets/timeless-rule-trips-widget-2.tsx`, and `src/features/trips/trip-detail-sheet/trip-detail-sheet-3.tsx` do not exist in the current tree. The current files are `src/query/keys/trips.ts`, `src/features/dashboard/components/pending-tours-widget.tsx`, `src/features/dashboard/components/timeless-rule-trips-widget.tsx`, and `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`.

| File | Call site / function | Keys invalidated |
| --- | --- | --- |
| `src/features/dashboard/components/pending-tours-widget.tsx` | `UnplannedTripRow.handleSetTime` calls `tripsService.updateTrip(trip.id, updatePayload)` | `tripKeys.unplannedRoot` awaited, `tripKeys.detail(trip.id)` fire-and-forget. ⚠️ Missing `tripKeys.timelessRuleTripsRoot`. |
| `src/features/dashboard/components/timeless-rule-trips-widget.tsx` | `TimelessRulePairRow.handleSave` calls `tripsService.updateTrip(e.trip.id, { scheduled_at })` for each edited leg | `tripKeys.detail(e.trip.id)` per edited leg, then `tripKeys.timelessRuleTripsRoot`. ⚠️ Missing `tripKeys.unplannedRoot`. |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `handleDriverChange` calls `tripsService.updateTrip(trip.id, patch)` | `tripKeys.detail(trip.id)`, `tripKeys.all`, then `refreshAfterTripSave()`, which also refreshes RSC / invalidates `tripKeys.all`. ⚠️ Missing `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot`. |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `applyNotesSave` calls `useUpdateTripMutation().mutateAsync({ id, patch: { notes } })` for current trip and optionally linked partner | Mutation invalidates `tripKeys.detail(id)` and `tripKeys.all` on settle. Partner path additionally invalidates `tripKeys.detail(linkedPartner.id)`. Then `refreshAfterTripSave()` refreshes RSC / invalidates `tripKeys.all`. ⚠️ Missing widget roots, though notes do not affect these widget predicates. |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `applyDetailsPatch` calls `useUpdateTripMutation().mutateAsync({ id, patch })` for current trip and optionally linked partner. This patch includes `scheduled_at` / `requested_date` when header date/time changes. | Mutation invalidates `tripKeys.detail(id)` and `tripKeys.all` on settle. Partner path additionally invalidates `tripKeys.detail(linkedPartner.id)`. Then `refreshAfterTripSave()` refreshes RSC / invalidates `tripKeys.all`. ⚠️ Missing `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot`. |
| `src/features/trips/hooks/use-update-trip-mutation.ts` | `mutationFn` calls `tripsService.updateTrip(id, patch)` | `onMutate`: cancels and optimistically merges `tripKeys.detail(id)`. `onSettled`: invalidates `tripKeys.detail(id)` and `tripKeys.all`. ⚠️ Missing widget roots globally. |
| `src/features/trips/hooks/use-trip-field-update.ts` | `updateField` delegates to `useUpdateTripMutation().mutate` | Same as `useUpdateTripMutation`: `tripKeys.detail(id)` and `tripKeys.all`. ⚠️ Missing widget roots globally, though current callers update KTS/Reha fields only. |
| `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` | `persist` calls `tripsService.updateTrip(trip.id, patch)` | `tripKeys.detail(trip.id)`, then optional `onAfterSave()` from the sheet, currently `refreshAfterTripSave()`. ⚠️ Missing widget roots; mostly assignment-like fields, so it can affect unplanned membership. |
| `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `handleAssign` calls `tripsService.updateTrip(tripId, updates)` | No TanStack invalidation. It updates local hook state or reloads its own local data via `load()`. ⚠️ Missing both widget roots. |
| `src/features/trips/components/kanban/kanban-board.tsx` | `handleSave` calls `tripsService.updateTrip(id, payload)` for pending changes | `tripKeys.all`, then `refreshTripsPage()` from `TripsRscRefreshProvider`, which also invalidates `tripKeys.all`. ⚠️ Missing both widget roots. |
| `src/features/trips/hooks/use-widget-trip-assignment.ts` | `mutationFn` calls `tripsService.updateTrip(trip.id, patch)` when not group-scoped | `tripKeys.all` on success. ⚠️ Missing both widget roots. |
| `src/features/invoices/lib/trip-write-back.ts` | `executeTripWriteBack` calls `tripsService.updateTrip(item.trip_id!, patch)` | None in this helper. ⚠️ Missing both widget roots, but patches are invoice price fields and do not affect widget predicates. |
| `src/features/invoices/lib/trip-write-back.ts` | `retryTripWriteBack` calls `tripsService.updateTrip(trip_id, patch)` | None in this helper. ⚠️ Missing both widget roots, but patches are invoice price fields and do not affect widget predicates. |
| `src/features/kts/kts.service.ts` | `updateTripKts` calls `tripsService.updateTrip(tripId, normalized)` | None in the service. ⚠️ Missing both widget roots, but KTS fields do not affect widget predicates. |
| `src/features/kts/hooks/use-update-kts-mutation.ts` | `mutationFn` calls `updateTripKts(id, patch)`, which calls `tripsService.updateTrip` | `onMutate`: cancels and optimistically merges `tripKeys.detail(id)`. `onSettled`: invalidates `tripKeys.detail(id)` and `tripKeys.all`. ⚠️ Missing both widget roots, but KTS fields do not affect widget predicates. |
| `src/features/trips/lib/create-linked-return.ts` | `createLinkedReturnForOutbound` calls `tripsService.updateTrip(outbound.id, { linked_trip_id, link_type })` after creating the return leg | None in this helper. Its current dialog caller relies on parent-side realtime / linked partner refresh only. ⚠️ Missing both widget roots. |

Test-only note: `src/features/invoices/lib/__tests__/trip-write-back.test.ts` assigns a mock to `tripsService.updateTrip`; it is not a runtime save path.

## 2. useTripDetailSaveRefresh Analysis

`useTripDetailSaveRefresh` exposes `refreshAfterTripSave()`.

Current behavior:

- If the sheet is rendered under `TripsRscRefreshProvider`, it calls `optionalRscRefresh.refreshTripsPage()`.
- `refreshTripsPage()` does `router.refresh()` and then `queryClient.invalidateQueries({ queryKey: tripKeys.all })`.
- If no provider exists, the hook directly does `router.refresh()` and `queryClient.invalidateQueries({ queryKey: tripKeys.all })`.

It does not invalidate:

- `tripKeys.detail(tripId)`
- `tripKeys.unplannedRoot`
- `tripKeys.timelessRuleTripsRoot`

Detail invalidation is handled elsewhere: `useUpdateTripMutation` invalidates `tripKeys.detail(id)` on settle, and `handleDriverChange` invalidates `tripKeys.detail(trip.id)` directly.

Adding the two widget roots directly inside `useTripDetailSaveRefresh` would fix the confirmed sheet bug for notes/details/driver/fremdfirma sheet saves, because every major sheet save path calls it. The risk is not correctness but scope: the hook currently has no `tripId` or `patch`, so it cannot distinguish a time/status/assignee save from a notes-only save. It would invalidate both dashboard widget roots even after edits that cannot affect either widget. There is also already duplicate `tripKeys.all` invalidation in some sheet paths, so adding more logic here continues the current duplication pattern instead of centralizing it.

## 3. useUpdateTripMutation Analysis

`useUpdateTripMutation` performs invalidation on `onSettled`, not `onSuccess`.

Current behavior:

- `onMutate`: cancels `tripKeys.detail(id)` and optimistically merges the patch into cached detail data.
- `onError`: restores the previous `tripKeys.detail(id)` value.
- `onSettled`: invalidates `tripKeys.detail(id)` and `tripKeys.all`.

It does not invalidate `tripKeys.unplannedRoot` or `tripKeys.timelessRuleTripsRoot`.

Adding widget keys globally here is possible but too broad as a default. This mutation is used directly by the detail sheet and indirectly by `useTripFieldUpdate`; the current inline field callers update KTS/Reha fields, and notes saves use the same mutation. Invalidating both dashboard widget roots for every notes, KTS, Reha, billing, price, or route edit would create avoidable refetches on screens that may not display either widget.

If the mutation hook is extended, it should be with an explicit option or a helper call that can decide from the patch whether planning widgets are affected. A blanket global side effect is not the cleanest architecture.

## 4. Fix Approach Evaluation

### A. Add Missing Invalidations In `useTripDetailSaveRefresh`

This is the smallest direct fix for the confirmed bug. Because all main Trip Detail Sheet save paths call `refreshAfterTripSave()`, adding:

- `queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot })`
- `queryClient.invalidateQueries({ queryKey: tripKeys.timelessRuleTripsRoot })`

would remove stale dashboard widget rows after sheet saves.

Tradeoff: the hook has no patch context. It would refetch widgets after saves that cannot affect them, such as notes-only changes. It also leaves the widgets' own save paths and other future trip save paths with separate invalidation logic.

### B. Add Widget Roots Globally In `useUpdateTripMutation`

This centralizes one subset of writes, but it misses direct `tripsService.updateTrip` callers such as the widget rows, sheet driver changes, Kanban saves, pending assignments, Fremdfirma saves, KTS service wrappers, and linked return creation.

Tradeoff: it is both too broad for the mutation users that only edit non-planning fields and incomplete for the direct service callers. I would not choose this as the main fix.

### C. Create A Shared Invalidation Helper

This is the cleanest option. The code already has multiple write paths and multiple cache layers:

- detail query cache
- `tripKeys.all`
- RSC refresh for `/dashboard/trips`
- dashboard widget roots

A shared helper lets each save path call one contract instead of hand-maintaining a partial set of invalidations.

Recommended path:

- `src/features/trips/lib/invalidate-after-trip-save.ts`

Recommended exports:

- `planningWidgetAffectingTripPatchKeys`
- `doesTripPatchAffectPlanningWidgets(patch)`
- `invalidateAfterTripSave(queryClient, options)`

Recommended signature:

```ts
import type { QueryClient } from '@tanstack/react-query';
import type { UpdateTrip } from '@/features/trips/api/trips.service';

export interface InvalidateAfterTripSaveOptions {
  tripIds?: string | string[];
  patch?: Partial<UpdateTrip> | Array<Partial<UpdateTrip>>;
  includeTripList?: boolean;
  includePlanningWidgets?: boolean | 'auto';
}

export function doesTripPatchAffectPlanningWidgets(
  patch: Partial<UpdateTrip>
): boolean;

export async function invalidateAfterTripSave(
  queryClient: QueryClient,
  options: InvalidateAfterTripSaveOptions
): Promise<void>;
```

Suggested behavior:

- Always invalidate `tripKeys.detail(id)` for each supplied `tripId`.
- Invalidate `tripKeys.all` unless `includeTripList === false`.
- Invalidate `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot` when `includePlanningWidgets === true`, or when `includePlanningWidgets === 'auto'` and the patch touches widget-affecting fields.
- Treat these patch keys as widget-affecting: `scheduled_at`, `requested_date`, `status`, `driver_id`, `fremdfirma_id`, `rule_id`, `linked_trip_id`, `link_type`.

Current save path usage:

- PendingToursWidget row save: call helper after `tripsService.updateTrip`, with `tripIds: trip.id`, `patch: updatePayload`, `includePlanningWidgets: true`.
- TimelessRuleTripsWidget row save: call helper after each edited leg or once with all edited IDs, `includePlanningWidgets: true`.
- TripDetailSheet details save: after `mutateAsync`, call helper with the current trip id, optional partner id, the patch or patches, and `includePlanningWidgets: 'auto'`.
- TripDetailSheet driver and Fremdfirma saves: call helper with the assignment patch and `includePlanningWidgets: 'auto'`.
- Kanban and pending assignment saves: call helper with all updated IDs/patches and `includePlanningWidgets: 'auto'`.
- Non-planning writes such as invoice price write-back and KTS-only updates can call it with `includePlanningWidgets: false` if they need detail/list alignment, or keep their existing narrower invalidation.

### D. Other Option

Another option is to extend `TripsRscRefreshProvider.refreshTripsPage()` to also invalidate both widget roots. I do not recommend that as the primary fix. The provider is documented as coordinating the Fahrten RSC payload plus `tripKeys.all`; dashboard widgets are separate TanStack queries and are not necessarily tied to every trips page refresh. Expanding the provider would make every filter/view refresh refetch dashboard widget queries if mounted, even when no trip write happened.

## 5. Query Key Definitions

The current trip query keys live in `src/query/keys/trips.ts`.

Exact definitions:

```ts
export const tripKeys = {
  all: ['trips'] as const,
  detail: (tripId: string) => ['trips', 'detail', tripId] as const,
  unplannedRoot: ['trips', 'unplanned'] as const,
  unplanned: (filter: UnplannedTripsFilter) =>
    ['trips', 'unplanned', filter] as const,
  timelessRuleTripsRoot: ['trips', 'timeless-rules'] as const,
  timelessRuleTrips: (todayYmd: string, tomorrowYmd: string) =>
    ['trips', 'timeless-rules', todayYmd, tomorrowYmd] as const
};
```

`tripKeys.unplannedRoot` is a static array:

- `['trips', 'unplanned'] as const`

`tripKeys.timelessRuleTripsRoot` is a static array:

- `['trips', 'timeless-rules'] as const`

They are not factory functions. Correct invalidation syntax is:

```ts
queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
queryClient.invalidateQueries({ queryKey: tripKeys.timelessRuleTripsRoot });
```

## 6. Other Risky Mutation Sites

These paths can mutate fields that influence the two widgets or adjacent planning UI, and should be considered when centralizing the invalidation contract:

- `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` and `src/features/trips/trip-reschedule/api/reschedule.actions.ts`: updates `scheduled_at` and `requested_date` via direct Supabase `.update()`. The dialog refreshes RSC / invalidates `tripKeys.all`, but not the widget roots. This can create the same issue when a trip becomes time-open or receives a time outside the widget row save path.
- `src/features/trips/hooks/use-trip-cancellation.ts`: cancellation changes `status` through recurring exception actions and refreshes RSC / invalidates `tripKeys.all`, but not the widget roots. Since both widgets exclude `cancelled` and `completed`, this can leave stale widget rows until realtime/staleTime/page reload catches up.
- `src/features/trips/components/kanban/kanban-board.tsx`: staged saves may update `scheduled_at`, `driver_id`, `status`, `payer_id`, `group_id`, and `stop_order`. It invalidates `tripKeys.all` and refreshes RSC, but not widget roots.
- `src/features/trips/components/pending-assignments/use-pending-assignments.ts`: updates `scheduled_at` and/or assignment fields. It manages local state or reloads its own hook data, but does not invalidate widget roots.
- `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx`: updates Fremdfirma assignment fields through `tripsService.updateTrip`; from the sheet it then calls `refreshAfterTripSave()`, but widget roots are not invalidated.
- `src/features/trips/lib/create-linked-return.ts` via `CreateReturnTripDialog`: creates a scheduled return trip and updates the outbound `linked_trip_id` / `link_type`. The dialog only triggers parent linked-partner refresh, relying on realtime for broader list updates.
- `src/features/clients/components/recurring-rule-panel.tsx` and `src/features/clients/components/recurring-rule-sheet.tsx`: recurring rule updates can resync future generated trips' `scheduled_at`. They invalidate `tripKeys.all` when rows are resynced, but not widget roots.
- `src/features/trips/components/bulk-upload/resolve-clients-step.tsx`: directly updates a trip's client/address data via Supabase. It does not currently affect widget predicates, but it is another direct `trips` update path outside the shared service/mutation invalidation contract.
- `src/features/trips/api/recurring-rules.actions.ts`: server action batch-updates generated trips' `scheduled_at` during rule resync. Client callers only invalidate `tripKeys.all`.

## 7. Senior Recommendation

Use option C: create a shared helper and move the widget-root invalidation contract into it. The bug exists because every save path currently owns a partial local idea of what "trip save refresh" means. Adding two lines to `useTripDetailSaveRefresh` fixes the confirmed symptom, but it preserves the fragmentation and will be easy to miss again when the next save entry point is added.

I would implement `src/features/trips/lib/invalidate-after-trip-save.ts` with this exact public API:

```ts
export interface InvalidateAfterTripSaveOptions {
  tripIds?: string | string[];
  patch?: Partial<UpdateTrip> | Array<Partial<UpdateTrip>>;
  includeTripList?: boolean;
  includePlanningWidgets?: boolean | 'auto';
}

export async function invalidateAfterTripSave(
  queryClient: QueryClient,
  options: InvalidateAfterTripSaveOptions
): Promise<void>;
```

Default behavior should be conservative for correctness:

- detail keys for supplied IDs
- `tripKeys.all` unless opted out
- widget roots when explicitly requested or when patch inspection detects planning-relevant fields

Then update current save paths to call it:

- Widget row saves should pass `includePlanningWidgets: true` because their entire purpose is to remove rows from those widgets immediately.
- Trip Detail Sheet details save should pass `includePlanningWidgets: 'auto'` with the actual patch, so changing `scheduled_at`, `requested_date`, `status`, assignee, or recurring/link metadata refreshes the widgets, while notes-only saves do not.
- Trip Detail Sheet driver/Fremdfirma saves should use the helper with the assignment patch.
- Kanban, pending assignments, reschedule, cancellation, and recurring-rule resync should use the same helper when they mutate scheduling/status/assignment fields.

As a minimal interim fix, adding both widget root invalidations to `useTripDetailSaveRefresh` is acceptable and low-risk because dashboard widget queries are only active when mounted. As the durable fix, the shared helper is better: it makes the cache contract discoverable, keeps future entry points honest, and avoids turning `useUpdateTripMutation` into an overly broad global side effect.

## 8. Implementation Status

**Status: COMPLETE (v2 — 2026-06-23)**

### v1 (initial fix)

- `src/features/trips/lib/invalidate-after-trip-save.ts` — shared helper
- `useTripDetailSaveRefresh` — forwards helper options with `includeTripList: false`
- Trip Detail Sheet `handleDriverChange` and `applyDetailsPatch` — pass patch context with `includePlanningWidgets: 'auto'`
- `PendingToursWidget` and `TimelessRuleTripsWidget` row saves — `includePlanningWidgets: true`

### v2 (deferred paths)

- `trip-reschedule-dialog.tsx` — reschedule success handler
- `use-trip-cancellation.ts` — cancellation success handler
- `kanban-board.tsx` — staged save flush
- `use-pending-assignments.ts` (`useDispatchInbox.handleAssign`)
- `create-return-trip-dialog.tsx` — linked return creation (lib unchanged)
- `recurring-rule-panel.tsx` and `recurring-rule-sheet.tsx` — resync + shorten confirm
- `resolve-clients-step.tsx` — bulk upload client resolution (`includePlanningWidgets: false`)

See `docs/trips/invalidation-contract.md` for the full contract and caller table.

## Deferred Paths

The following sites were deferred from v1 and **migrated in v2 (2026-06-23)**:

| File | What it mutates | Status |
| --- | --- | --- |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | `scheduled_at`, `requested_date` | **MIGRATED IN V2** |
| `src/features/trips/hooks/use-trip-cancellation.ts` | `status` | **MIGRATED IN V2** |
| `src/features/trips/components/kanban/kanban-board.tsx` | scheduling, driver, status | **MIGRATED IN V2** |
| `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `scheduled_at`, assignment | **MIGRATED IN V2** |
| `src/features/trips/lib/create-linked-return.ts` | `linked_trip_id`, `link_type` | **MIGRATED IN V2** (invalidation in dialog) |
| `src/features/clients/components/recurring-rule-panel.tsx` | batch `scheduled_at` resync | **MIGRATED IN V2** |
| `src/features/clients/components/recurring-rule-sheet.tsx` | batch `scheduled_at` resync | **MIGRATED IN V2** |
| `src/features/trips/api/recurring-rules.actions.ts` | server batch `scheduled_at` | **MIGRATED IN V2** (client callers) |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | client/address | **MIGRATED IN V2** |

Still deferred (v4 / low risk):

| File | What it mutates | Why still deferred |
| --- | --- | --- |
| `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` | Fremdfirma assignment | v4 — no-options `refreshAfterTripSave` blocker |
| `src/features/trips/hooks/use-widget-trip-assignment.ts` | assignment patch | Medium risk; not migrated |
| `src/features/invoices/lib/trip-write-back.ts` | invoice price | Permanently deferred — widgets unaffected |
| `src/features/kts/kts.service.ts` / `use-update-kts-mutation.ts` | KTS fields | Permanently deferred — widgets unaffected |

**v4 hook simplification blockers** (pass no options to `refreshAfterTripSave`): `applyNotesSave` (trip-detail-sheet.tsx ~751), `onAfterSave={refreshAfterTripSave}` on `TripFremdfirmaSection` (~1584), Fremdfirma `persist` path (trip-fremdfirma-section.tsx ~107–113).

## V3 Summary

Date: **2026-06-23**

- **`useUpdateTripMutation.onSettled`** now calls `invalidateAfterTripSave` with `includePlanningWidgets: 'auto'` — KTS/Reha inline consumers do not over-invalidate widgets.
- **ESLint rule** `invalidation-contract/no-direct-widget-invalidation` added (`src/eslint-rules/`, registered via `eslint-plugin-invalidation-contract` + `.eslintrc.cjs`). Detects both `tripKeys.unplannedRoot` member expressions and inline `['trips', 'unplanned']` literals.
- **`useTripDetailSaveRefresh` simplification** deferred to v4 (three no-options callers documented in [`invalidation-contract.md`](../trips/invalidation-contract.md)).
- **Lint script:** `package.json` `lint` runs `eslint src` (Next.js 16 removed `next lint`).

## V2 Summary

Date: **2026-06-23**

All seven v1-deferred planning-affecting save paths now call `invalidateAfterTripSave`. Bulk upload client resolution uses the helper with `includePlanningWidgets: false` for contract completeness. Server actions (`recurring-rules.actions.ts`, `reschedule.actions.ts`) remain React-free; invalidation lives in client success handlers.

## Manual Smoke Test (v1 acceptance)

After deployment or local dev verification:

1. Open `/dashboard/overview` with both **Offene Touren** and **Regelfahrten ohne Zeit** widgets visible.
2. Find a passenger row that appears in **both** widgets (unplanned trip with a timeless rule leg).
3. Open that trip in the Trip Detail Sheet and set a time via the header date/time save (details save path).
4. Without reloading the page, confirm the passenger disappears from **both** widgets.

**Result:** _Pending manual verification in running app — document observed outcome here after test._

## V2 Smoke Tests

| Test | Steps | Result |
| --- | --- | --- |
| Reschedule | Reschedule a trip visible in both widgets via Verschieben dialog | _Pending_ |
| Cancel | Cancel a trip visible in a widget | _Pending_ |
| Kanban | Save a Kanban change that includes `scheduled_at` | _Pending_ |
| Pending assignments | Assign a driver via pending assignments UI; trip leaves unplanned widget without reload | _Pending_ |

## Unresolved direct widget invalidations

Grep run 2026-06-23:

```bash
grep -r "tripKeys.unplannedRoot\|tripKeys.timelessRuleTripsRoot" src/ --include="*.ts" --include="*.tsx"
```

**Trip write paths:** None found outside [`invalidate-after-trip-save.ts`](../src/features/trips/lib/invalidate-after-trip-save.ts) — contract complete for widget roots on save paths.

**Non-write references (expected, not flagged):**

- [`src/query/keys/trips.ts`](../src/query/keys/trips.ts) — key definitions
- [`src/features/dashboard/hooks/use-unplanned-trips.ts`](../src/features/dashboard/hooks/use-unplanned-trips.ts) — Supabase realtime debounced invalidation via `createDebouncedInvalidateByQueryKey`
- [`src/features/dashboard/hooks/use-timeless-rule-trips.ts`](../src/features/dashboard/hooks/use-timeless-rule-trips.ts) — same realtime pattern
- [`src/query/README.md`](../src/query/README.md) — documentation (may reference pre-v2 widget save pattern; update separately if desired)

