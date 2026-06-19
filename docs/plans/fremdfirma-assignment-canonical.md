# Fremdfirma assignment — canonical write model

**Status:** Complete — 2026-06-19

## Problem

Fremdfirma assign from `pending` never promoted `status` to `assigned` because `getStatusWhenDriverChanges` only looked at `driver_id` changes. Fremdfirma rows keep `driver_id = null` by design.

## Solution (Option B)

- Added `getStatusWhenAssignmentChanges` and `buildAssignmentPatch` to `src/features/trips/lib/trip-assignee.ts`
- Deleted `getStatusWhenDriverChanges` from `src/features/trips/lib/trip-status.ts`
- Migrated all 10 consumer call sites + insert builders + dispatch inbox
- Backfill migration: `supabase/migrations/20260619120000_fix_fremdfirma_status.sql`

## Status transition table

| Current | Effective assignee | Result |
|---------|-------------------|--------|
| `pending` / `open` | driver **or** Fremdfirma | `assigned` |
| `pending` / `open` | both null | no change |
| `assigned` | both null | `pending` |
| `assigned` | driver **or** Fremdfirma | no change |
| terminal (`in_progress`, `driving`, `completed`, `cancelled`, `scheduled`) | any | no change |

## Migration note

The backfill predicate includes `driver_id IS NULL` because Fremdfirma trips intentionally have no internal driver — only `status` was wrong on legacy rows.

Post-migration verification (prod): **0** rows with `fremdfirma_id IS NOT NULL AND status IN ('pending', 'open')`.

## Manual smoke checklist (implementation session)

Automated build + unit tests passed. Manual UI verification not run in this session — use before release:

1. Fremdfirma assign on `Offen` trip → badge **Zugewiesen**
2. Remove Fremdfirma (no driver) → **Offen**
3. Assign internal driver on `Offen` → **Zugewiesen**
4. Remove driver (no Fremdfirma) → **Offen**
5. `/fahrten` filter **Zugewiesen** includes Fremdfirma trips
6. Kanban drag to driver column → DB `assigned`
7. Pending tours widget time + driver → DB `assigned`
8. Dispatch inbox assign driver → DB `assigned` + `needs_driver_assignment: false`
9. Kanban time-only save on assigned trip → driver **not** cleared

## Related docs

- [`trip-assignee.md`](../features/trips/trip-assignee.md) — module reference
- [`fremdfirma-status-audit.md`](fremdfirma-status-audit.md) — root cause audit
- [`fremdfirma-callgraph-audit.md`](fremdfirma-callgraph-audit.md) — call-site inventory
