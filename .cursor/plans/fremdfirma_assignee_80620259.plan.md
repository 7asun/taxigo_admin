---
name: Fremdfirma Assignee
overview: Introduce a canonical trip assignee abstraction for driver, Fremdfirma, and truly unassigned trips, then wire it into the Fahrten list/filter, dashboard dispatch queues, Kanban, and print ZIP without touching CSV export or deferred reporting surfaces.
todos:
  - id: core-assignee
    content: Add core TripAssignee utilities and shared join fragments
    status: completed
  - id: display-component
    content: Add shared TripAssigneeBadge display component
    status: completed
  - id: fahrten-filter-table
    content: Integrate assignee filter and table/mobile display
    status: completed
  - id: dispatch-dashboard
    content: Fix unassigned dashboard and dispatch query semantics
    status: completed
  - id: kanban-exclusion
    content: Exclude Fremdfirma consistently from Kanban planning
    status: completed
  - id: print-grouping
    content: Group Fremdfirma trips correctly in print ZIP
    status: completed
  - id: docs-verify
    content: Document abstraction and run build/lint verification
    status: completed
isProject: false
---

# Fremdfirma Assignee Abstraction Plan

## Key Decisions
- Use the existing `driver_id` URL param as the semantic assignee filter for saved-view compatibility: driver UUIDs remain unchanged, `unassigned` means no driver and no Fremdfirma, and Fremdfirma values use `fremdfirma:<uuid>` plus `fremdfirma:all`.
- Parse the overloaded `driver_id` value with one clear helper, for example `parseAssigneeParam(driverIdParam)`, instead of scattering `startsWith('fremdfirma:')` and `if/else` checks through the query builder.
- Do not add a separate Fremdfirma count to `PendingToursWidget` in this plan, because scheduled Fremdfirma trips will be excluded from the unplanned query and the hard rule forbids adding a new query.
- Keep CSV export, invoice snapshots, client trip panel, and controlling chart grouping deferred.

## Implementation
- Add pure shared trip assignee utilities in [`src/features/trips/lib/trip-assignee.ts`](src/features/trips/lib/trip-assignee.ts): `TripAssignee`, `resolveTripAssignee`, `isTripUnassignedForDispatch`, `isTripFremdfirma`, and `parseAssigneeParam(driverIdParam)` for the overloaded `driver_id` URL value.
- Add shared Supabase join fragments in [`src/features/trips/lib/trip-query-fragments.ts`](src/features/trips/lib/trip-query-fragments.ts): `DRIVER_JOIN_FRAGMENT`, `FREMDFIRMA_JOIN_FRAGMENT`, and `ASSIGNEE_JOIN_FRAGMENT`.
- Add [`src/features/trips/components/trip-assignee-badge.tsx`](src/features/trips/components/trip-assignee-badge.tsx) as a pure display component matching the current `DriverSelectCell` Fremdfirma style.
- Update [`src/features/trips/lib/trip-status.ts`](src/features/trips/lib/trip-status.ts) to use the shared unassigned predicate internally while preserving current status behavior.
- Update [`src/features/trips/components/trips-listing.tsx`](src/features/trips/components/trips-listing.tsx) to import join fragments and call `parseAssigneeParam(driverId)` once before query construction. The query builder should branch on the parsed discriminant: `unassigned` applies both null guards, `fremdfirma:all` applies `fremdfirma_id IS NOT NULL`, `fremdfirma:<uuid>` applies `fremdfirma_id = uuid`, and `driver` applies `driver_id = uuid`.
- Update [`src/features/trips/components/trips-filters-bar.tsx`](src/features/trips/components/trips-filters-bar.tsx) to load Fremdfirmen via existing `useFremdfirmenQuery()`, add Fremdfirma options into the existing Fahrer dropdown, and continue writing only `driver_id`.
- Update table display in [`src/features/trips/components/trips-tables/driver-select-cell.tsx`](src/features/trips/components/trips-tables/driver-select-cell.tsx), [`src/features/trips/components/trips-tables/columns.tsx`](src/features/trips/components/trips-tables/columns.tsx), and [`src/features/trips/components/trips-tables/trips-mobile-card-list.tsx`](src/features/trips/components/trips-tables/trips-mobile-card-list.tsx) to resolve/display canonical assignee while leaving the existing Fremdfirma detail columns unchanged.
- Update dispatch queries in [`src/features/dashboard/hooks/use-unplanned-trips.ts`](src/features/dashboard/hooks/use-unplanned-trips.ts), [`src/features/trips/components/pending-assignments/use-pending-assignments.ts`](src/features/trips/components/pending-assignments/use-pending-assignments.ts), and [`src/features/trips/components/pending-assignments/debug-queries.ts`](src/features/trips/components/pending-assignments/debug-queries.ts) so `driver_id IS NULL` is never used alone for dispatch-unassigned. The dashboard OR query keeps the grouped expression `scheduled_at.is.null OR (driver_id IS NULL AND fremdfirma_id IS NULL)`.
- Update [`src/features/dashboard/components/pending-tours-widget.tsx`](src/features/dashboard/components/pending-tours-widget.tsx) to count `ohne Fahrer` via `isTripUnassignedForDispatch`, with no new count query.
- Update Kanban in [`src/features/trips/components/kanban/kanban-board.tsx`](src/features/trips/components/kanban/kanban-board.tsx), [`src/features/trips/lib/kanban-columns.ts`](src/features/trips/lib/kanban-columns.ts), and [`src/features/trips/lib/kanban-grouping.ts`](src/features/trips/lib/kanban-grouping.ts) so Fremdfirma trips are excluded consistently from the internal planning board, including grouping/actions that currently operate on `effectiveTrips`; show a slim banner linking to `/dashboard/trips?driver_id=fremdfirma%3Aall` when any are hidden.
- Update print ZIP in [`src/features/trips/components/print-trips-button.tsx`](src/features/trips/components/print-trips-button.tsx), [`src/features/trips/components/mobile-print-template.tsx`](src/features/trips/components/mobile-print-template.tsx), and [`src/features/trips/components/board-landscape-only-print-template.tsx`](src/features/trips/components/board-landscape-only-print-template.tsx) so print queries include the Fremdfirma join and external trips group as `Extern · <CompanyName>`, not `Nicht zugewiesen`.
- Add documentation in [`docs/features/trips/trip-assignee.md`](docs/features/trips/trip-assignee.md) and implementation status in [`docs/plans/fremdfirma-assignee-plan.md`](docs/plans/fremdfirma-assignee-plan.md).

## Verification
- Run `bun run build` after each major step as requested, and also run targeted lint diagnostics on edited files after substantive edits.
- Final check must confirm no files under [`src/app/api/trips/export/`](src/app/api/trips/export/) changed.