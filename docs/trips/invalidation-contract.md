# Trip Save Invalidation Contract

## Purpose

Trip writes touch several independent React Query caches: per-trip detail rows, the broad Fahrten list (`tripKeys.all`), and two dashboard planning widgets (`PendingToursWidget`, `TimelessRuleTripsWidget`). Save paths previously invalidated a partial subset, which left stale widget rows after Trip Detail Sheet saves.

`invalidateAfterTripSave` centralizes the client-side invalidation contract. Call it once after a successful trip write (or via `useTripDetailSaveRefresh` from the detail sheet).

## Helper API

Location: `src/features/trips/lib/invalidate-after-trip-save.ts`

```ts
export interface InvalidateAfterTripSaveOptions {
  tripIds?: string | string[];
  patch?: Partial<UpdateTrip> | Array<Partial<UpdateTrip>>;
  includeTripList?: boolean; // default true
  includePlanningWidgets?: boolean | 'auto'; // default false
}

export async function invalidateAfterTripSave(
  queryClient: QueryClient,
  options?: InvalidateAfterTripSaveOptions
): Promise<void>;
```

Also exported:

- `PLANNING_WIDGET_PATCH_KEYS` — keys inspected by `'auto'`
- `doesPatchAffectPlanningWidgets(patch)` — predicate used by `'auto'`

Default behavior:

1. Invalidate `tripKeys.detail(id)` for each supplied `tripId`.
2. Invalidate `tripKeys.all` unless `includeTripList === false`.
3. Invalidate `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot` when `includePlanningWidgets === true`, or when `'auto'` and any supplied patch touches a planning-affecting key.

## includePlanningWidgets Modes

| Mode | Behavior |
| --- | --- |
| `false` (default) | Skip widget root invalidation. Use for notes-only or non-planning field writes when the caller does not need dashboard widgets refreshed. |
| `true` | Always invalidate both widget roots. Use when the save path's purpose is to assign a time or otherwise remove a row from a planning widget immediately. |
| `'auto'` | Inspect `patch` (or each patch in an array). Invalidate widget roots only when at least one patch touches a planning-affecting key. Use from Trip Detail Sheet saves where the patch varies (time change vs notes-only). |

## Planning-Affecting Patch Keys

These keys can change whether a trip appears in `PendingToursWidget` or `TimelessRuleTripsWidget`:

- `scheduled_at`
- `requested_date`
- `status`
- `driver_id`
- `fremdfirma_id`
- `rule_id`
- `linked_trip_id`
- `link_type`

## Current Callers

| File | Function | includePlanningWidgets | Notes |
| --- | --- | --- | --- |
| `src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts` | `refreshAfterTripSave` | caller-supplied | Forwards options with `includeTripList: false` (RSC refresh already invalidates `tripKeys.all`). |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `handleDriverChange` | `'auto'` | Full assignment patch from `buildAssignmentPatch`. |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `applyDetailsPatch` | `'auto'` | `[trip.id]` or `[trip.id, partner.id]` based on `syncPartner`. |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `applyNotesSave` | (default `false`) | No options — notes do not affect widgets. |
| `src/features/dashboard/components/pending-tours-widget.tsx` | `UnplannedTripRow.handleSetTime` | `true` | Row save assigns time/driver. |
| `src/features/dashboard/components/timeless-rule-trips-widget.tsx` | `TimelessRulePairRow.handleSave` | `true` | Patches use newly computed `scheduled_at`. |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | `handleSubmit` success | `true` | Primary ± paired leg; `includeTripList: false` after RSC refresh. |
| `src/features/trips/hooks/use-trip-cancellation.ts` | `cancelTrip` success | `true` | Primary ± linked partner id; `includeTripList: false` after RSC refresh. |
| `src/features/trips/components/kanban/kanban-board.tsx` | `handleSave` | `'auto'` | Collects staged payloads before save; `includeTripList: false` before `refreshTripsPage()`. |
| `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `useDispatchInbox.handleAssign` | `'auto'` | Additive to local state / `load()`. |
| `src/features/trips/components/return-trip/create-return-trip-dialog.tsx` | `handleSubmit` success | `true` | Outbound patch mirrors `create-linked-return.ts` outbound update. |
| `src/features/clients/components/recurring-rule-panel.tsx` | rule update / `handleShortenConfirm` | `true` | When `resynced > 0` or `deleted > 0`; no trip IDs (batch server resync). |
| `src/features/clients/components/recurring-rule-sheet.tsx` | rule update / `handleShortenConfirm` | `true` | Same as panel. |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | `handleCreateAndLinkClient` | `false` | Client/address only — explicit opt-out. |
| `src/features/trips/hooks/use-update-trip-mutation.ts` | `onSettled` | `'auto'` | All consumers of this mutation get detail, list, and conditional widget invalidation. |

### `useTripDetailSaveRefresh`

Location: `src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts`

Two layers today:

1. **RSC layer** — `router.refresh()` / `refreshTripsPage()` plus `tripKeys.all` when no provider.
2. **React Query layer** — forwards caller options to `invalidateAfterTripSave` with `includeTripList: false`.

**v4 blocked — hook simplification:** These callers invoke `refreshAfterTripSave()` with **no options**. Hook simplification (guard invalidation behind `if (options)`) is blocked until they are migrated:

| Caller | Location |
| --- | --- |
| `applyNotesSave` | `trip-detail-sheet.tsx` ~line 751 |
| `onAfterSave={refreshAfterTripSave}` on `TripFremdfirmaSection` | `trip-detail-sheet.tsx` ~line 1584 |
| Fremdfirma `persist` → `await onAfterSave?.()` | `trip-fremdfirma-section.tsx` ~lines 107–113 |

v4 candidate for Fremdfirma: pass `{ tripIds: [trip.id], patch, includePlanningWidgets: 'auto' }`.

## Enforcement

**Rule:** `invalidation-contract/no-direct-widget-invalidation` (error)

**Implementation:** [`src/eslint-rules/no-direct-widget-invalidation.js`](../src/eslint-rules/no-direct-widget-invalidation.js)

**Registration:** [`eslint-plugin-invalidation-contract/`](../eslint-plugin-invalidation-contract/) (local `file:` package) + [`.eslintrc.cjs`](../.eslintrc.cjs)

**What it catches:** Direct `queryClient.invalidateQueries({ queryKey: … })` when `queryKey` is `tripKeys.unplannedRoot`, `tripKeys.timelessRuleTripsRoot`, or an inline `['trips', 'unplanned' | 'timeless-rules']` array — anywhere outside `invalidate-after-trip-save.ts`.

**Exempt:** Test files (`*.test.ts`, `*.spec.ts`, …), the helper file itself, and `createDebouncedInvalidateByQueryKey` (realtime hooks — different callee).

**Adding a new trip save path:** Call `invalidateAfterTripSave(queryClient, { … })` with the appropriate `includePlanningWidgets` mode. Do not invalidate widget roots directly.

**If the rule fires on a legitimate path:** Extend the helper (or add a documented, reviewed exclusion) — do not bypass with raw `invalidateQueries` on widget roots.

## Permanently deferred (no ESLint flag — no direct widget-root calls)

| File | What it mutates | Why deferred |
| --- | --- | --- |
| `src/features/invoices/lib/trip-write-back.ts` | invoice price fields | Widget predicates unaffected |
| `src/features/kts/kts.service.ts` / `use-update-kts-mutation.ts` | KTS fields | Widget predicates unaffected |

## Deferred Paths (historical)

| File | What it mutates | Risk level | Status |
| --- | --- | --- | --- |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | `scheduled_at`, `requested_date` | High | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/trips/hooks/use-trip-cancellation.ts` | `status` | High | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/trips/components/kanban/kanban-board.tsx` | scheduling, driver, status | High | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `scheduled_at`, assignment | High | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/trips/lib/create-linked-return.ts` | `linked_trip_id`, `link_type` | Medium | **MIGRATED IN V2 (2026-06-23)** — invalidation in `create-return-trip-dialog.tsx` |
| `src/features/clients/components/recurring-rule-panel.tsx` | batch `scheduled_at` resync | Medium | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/clients/components/recurring-rule-sheet.tsx` | batch `scheduled_at` resync | Medium | **MIGRATED IN V2 (2026-06-23)** |
| `src/features/trips/api/recurring-rules.actions.ts` | server batch `scheduled_at` | Medium | **MIGRATED IN V2 (2026-06-23)** — client callers handle invalidation |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | client/address | Low | **MIGRATED IN V2 (2026-06-23)** — `includePlanningWidgets: false` |
| `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` | Fremdfirma assignment | Medium | Still deferred — v4: migrate no-options `refreshAfterTripSave` callers |
| `src/features/trips/hooks/use-widget-trip-assignment.ts` | assignment patch | Medium | Still deferred — only invalidates `tripKeys.all` |
| `src/features/invoices/lib/trip-write-back.ts` | invoice price fields | Low | **Permanently deferred** — see Enforcement |
| `src/features/kts/kts.service.ts` / `use-update-kts-mutation.ts` | KTS fields | Low | **Permanently deferred** — see Enforcement |
| `src/features/trips/hooks/use-update-trip-mutation.ts` | global mutation hook | N/A | **MIGRATED IN V3 (2026-06-23)** — `onSettled` uses helper with `'auto'` |

## V3 Complete (2026-06-23)

- **`useUpdateTripMutation.onSettled`** migrated to `invalidateAfterTripSave` with `includePlanningWidgets: 'auto'`.
- **ESLint rule** `invalidation-contract/no-direct-widget-invalidation` enforces the contract at commit time.
- **`useTripDetailSaveRefresh` simplification** deferred to v4 (blocking callers listed above).

## V4 Planned

- Migrate the three no-options `refreshAfterTripSave` callers, then simplify the hook (RSC layer + guarded React Query layer).
- Optional: `use-widget-trip-assignment.ts`, Fremdfirma section direct helper call.
- Optional contract-completeness pass: invoice write-back and KTS paths with `includePlanningWidgets: false`.
