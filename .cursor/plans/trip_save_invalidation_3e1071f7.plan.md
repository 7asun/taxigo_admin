---
name: trip save invalidation
overview: Create a shared trip-save invalidation utility and migrate only the confirmed dashboard widget and Trip Detail Sheet save paths. The plan preserves existing UI and mutation behavior while centralizing widget cache invalidation and documenting deferred paths.
todos:
  - id: create-helper
    content: Create `src/features/trips/lib/invalidate-after-trip-save.ts` with the shared invalidation API and WHY comments.
    status: completed
  - id: extend-refresh-hook
    content: Extend `useTripDetailSaveRefresh` to accept helper options while preserving current `tripKeys.all` behavior without duplicate list invalidation.
    status: completed
  - id: migrate-sheet
    content: Migrate Trip Detail Sheet details and driver save refresh calls to pass patch context through the helper.
    status: completed
  - id: migrate-widgets
    content: Migrate PendingToursWidget and TimelessRuleTripsWidget row saves to the shared helper.
    status: completed
  - id: update-docs
    content: Document deferred paths and create the trip invalidation contract doc.
    status: completed
  - id: verify-build
    content: Run `bun run build` after each step and check changed-file lints after edits.
    status: completed
isProject: false
---

# Shared Trip Save Invalidation Plan

## Scope
Implement the shared cache contract in these files only:

- [`src/features/trips/lib/invalidate-after-trip-save.ts`](src/features/trips/lib/invalidate-after-trip-save.ts)
- [`src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts`](src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts)
- [`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`](src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx)
- [`src/features/dashboard/components/pending-tours-widget.tsx`](src/features/dashboard/components/pending-tours-widget.tsx)
- [`src/features/dashboard/components/timeless-rule-trips-widget.tsx`](src/features/dashboard/components/timeless-rule-trips-widget.tsx)
- [`docs/plans/widget-cache-staleness-audit.md`](docs/plans/widget-cache-staleness-audit.md)
- [`docs/trips/invalidation-contract.md`](docs/trips/invalidation-contract.md)

Deferred paths stay documentation-only: reschedule, cancellation, Kanban, pending assignments, create-linked-return, recurring rule resync, and bulk-upload client resolution.

## Implementation
1. Create `invalidate-after-trip-save.ts` as a pure async utility.

   It will import only `QueryClient`, `UpdateTrip`, and `tripKeys`. It will export, in order:

   - `PLANNING_WIDGET_PATCH_KEYS`
   - `doesPatchAffectPlanningWidgets(patch)`
   - `InvalidateAfterTripSaveOptions`
   - `invalidateAfterTripSave(queryClient, options)`

   Planning keys will be `scheduled_at`, `requested_date`, `status`, `driver_id`, `fremdfirma_id`, `rule_id`, `linked_trip_id`, and `link_type`. The helper will invalidate supplied detail keys, `tripKeys.all` unless opted out, and both widget roots when requested or when `auto` detects planning-relevant patch keys.

   **Build gate:** run `bun run build` after this step and fix all type/build errors before continuing.

2. Extend `useTripDetailSaveRefresh` to accept optional helper options.

   The hook will keep the existing RSC refresh and broad `tripKeys.all` behavior. To avoid a second broad list invalidation from the helper, the hook will call the helper with `includeTripList: false` while preserving all caller-supplied options. This keeps current no-option callers behaviorally unchanged while allowing details/driver saves to request detail and widget invalidations.

   **Build gate:** run `bun run build` after this step and fix all type/build errors before continuing.

3. Migrate `TripDetailSheet` details and driver saves only.

   - `handleDriverChange` will remove the manual `queryClient.invalidateQueries({ queryKey: tripKeys.detail(trip.id) })` and `queryClient.invalidateQueries({ queryKey: tripKeys.all })` calls, then use one `refreshAfterTripSave({ tripIds: [trip.id], patch, includePlanningWidgets: 'auto' })` call. Use the actual `buildAssignmentPatch(...)` result rather than a reduced `{ driver_id }` patch so status/fremdfirma side effects stay visible to `auto`.
   - `applyDetailsPatch` must use the `patch` argument it receives as the source of truth. This matters because paired-dialog callbacks pass `pendingDetailsPatchRef.current` into `applyDetailsPatch`; do not re-derive from `built.patch` in this function.
   - In `applyDetailsPatch`, construct `currentPatch` exactly as today, including the notes merge when `syncPartner && notesDirty`. After the mutation(s), pass invalidation options explicitly:
     - When `syncPartner === false`: `tripIds: [trip.id]`, `patch: [currentPatch]`, `includePlanningWidgets: 'auto'`.
     - When `syncPartner === true`: `tripIds: [trip.id, linkedPartner.id]`, `patch: [currentPatch, partnerPatch]`, `includePlanningWidgets: 'auto'`.
   - Remove the now-redundant standalone partner detail invalidation in `applyDetailsPatch`, because the helper covers all supplied trip IDs.
   - `applyNotesSave` will remain no-options, so notes saves keep the current broad refresh but do not bust planning widget roots. Verify `useUpdateTripMutation.onSettled` invalidates `tripKeys.detail(id)` for every `mutateAsync` call. If it only invalidates the ID passed to each call, partner notes are already covered because the partner is saved through its own `mutateAsync`; if implementation differs, add explicit partner detail invalidation here.

   **Build gate:** run `bun run build` after this step and fix all type/build errors before continuing.

4. Migrate both dashboard widget row saves.

   - `PendingToursWidget` will replace its manual `tripKeys.unplannedRoot` and detail invalidations with `invalidateAfterTripSave(queryClient, { tripIds: [trip.id], patch: updatePayload, includePlanningWidgets: true })`.
   - `TimelessRuleTripsWidget` will collect `{ tripId, patch: { scheduled_at: scheduledAtIso } }` while saving each leg, then call the helper once after successful updates. This corrects the supplied pseudocode so it does not pass the old `e.trip.scheduled_at` value, which is `null` before refetch.

   **Build gate:** run `bun run build` after this step and fix all type/build errors before continuing.

5. Update docs.

   - Add a `## Deferred Paths` section to `docs/plans/widget-cache-staleness-audit.md`, listing every non-migrated risky site and why it remains deferred.
   - Create `docs/trips/invalidation-contract.md` with this structure:
     - `## Purpose`
     - `## Helper API`
     - `## includePlanningWidgets Modes`
     - `## Planning-Affecting Patch Keys`
     - `## Current Callers` with a table: `File | Function | Options passed`
     - `## Deferred Paths` with a table: `File | What it mutates | Risk level`
   - Add a manual smoke-test acceptance note to the audit file: after implementation, verify in the running app that saving a trip time through the Trip Detail Sheet header for a passenger currently shown in both widgets removes that passenger from both widgets without a page reload. Document the observed result in `docs/plans/widget-cache-staleness-audit.md`.

   **Build gate:** run `bun run build` after this step and fix all type/build errors before final verification.

## Verification
After each implementation step, run `bun run build` and stop to fix any type/build error before continuing. Cursor must not batch all steps and build only at the end. After edits, check lints for changed files with `ReadLints`. No UI, Supabase query, data-shape, or mutation behavior changes are planned.