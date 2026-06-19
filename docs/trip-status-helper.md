# Trip status on assignment changes

**Superseded:** `getStatusWhenDriverChanges` was removed in favour of the canonical write model in [`docs/features/trips/trip-assignee.md`](features/trips/trip-assignee.md).

Use **`buildAssignmentPatch(current, next)`** whenever you update `driver_id`, `fremdfirma_id`, or related billing fields. It returns the full assignee payload including optional `status` and `needs_driver_assignment`.

For Kanban drag staging only (no persist), use **`getStatusWhenAssignmentChanges(currentStatus, effective)`** with already-resolved effective assignee state.

Display labels (`Offen`, `Zugewiesen`, …) remain in `src/lib/trip-status.ts`.
