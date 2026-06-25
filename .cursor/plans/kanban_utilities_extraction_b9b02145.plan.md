---
name: Kanban Utilities Extraction
overview: Extract duplicated Kanban group label, sensor, and drop target resolution logic into shared utilities without changing runtime behavior. Documentation updates are included as an explicit exception to the original code-only file list.
todos:
  - id: extract-group-labels
    content: Extract `buildGroupLabels` and replace both board `groupLabels` useMemo blocks
    status: completed
  - id: extract-sensors
    content: Create `useKanbanSensors` and replace both board sensor blocks
    status: completed
  - id: extract-drop-resolver
    content: Create `resolveKanbanDropColumnId` and replace only the approved target-resolution blocks
    status: completed
  - id: docs-and-verify
    content: Document shared utilities, mark audit implemented, then run build/lint/lints verification
    status: completed
isProject: false
---

# Kanban Shared Utilities Extraction

## Files To Touch
- Code: [src/features/trips/lib/kanban-grouping.ts](src/features/trips/lib/kanban-grouping.ts), [src/features/trips/hooks/use-kanban-sensors.ts](src/features/trips/hooks/use-kanban-sensors.ts), [src/features/trips/lib/kanban-dnd.ts](src/features/trips/lib/kanban-dnd.ts), [src/features/trips/components/kanban/kanban-board.tsx](src/features/trips/components/kanban/kanban-board.tsx), [src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx](src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx)
- Docs exception: [docs/trips/kanban-shared-utilities.md](docs/trips/kanban-shared-utilities.md), [docs/plans/kanban-shared-utilities-audit.md](docs/plans/kanban-shared-utilities-audit.md)

## Implementation Plan
1. Extract `buildGroupLabels(trips: KanbanTrip[])` into `kanban-grouping.ts` after the existing exports, without modifying `chunkItemsByGroup` or `deriveStatusForPending`.
2. Replace both inline `groupLabels` `useMemo` bodies with `buildGroupLabels(effectiveTrips)` and `buildGroupLabels(trips)` respectively, preserving each dependency array.
3. Run `bun run build` before continuing.
4. Add `useKanbanSensors()` in `src/features/trips/hooks/use-kanban-sensors.ts` with the identical `MouseSensor` distance `5` and `TouchSensor` delay `120` / tolerance `8` configuration.
5. Replace both local sensor blocks with `const sensors = useKanbanSensors();` and remove now-unused dnd-kit sensor imports only from the two board files. Before removing any dnd-kit sensor import, confirm it has zero remaining references in that file. If any reference remains, keep the import and report it.
6. Run `bun run build` before continuing.
7. Add `resolveKanbanDropColumnId()` in `src/features/trips/lib/kanban-dnd.ts` with injected `getTripColumnId`, so main board `groupBy` logic and widget `resolveWidgetColumnId` logic remain separate.
8. Use the resolver only in the main board `handleDragOver` hover-column block, the main board final trip/group assignment block, and the widget `handleDragEnd` target-column block. Leave the main board column-reorder branch and grouping guard untouched.
9. Run `bun run build` before continuing.
10. Create `docs/trips/kanban-shared-utilities.md` if it does not exist, or update it if it does, documenting the three utilities, their consumers, the intentionally separate trip-column derivation strategies, and the deferred `getKanbanTripColumnId(trip, groupBy)` extraction.
11. Mark `docs/plans/kanban-shared-utilities-audit.md` as implemented.
12. Verify final state with `bun run build`, file-scoped ESLint for changed TS/TSX files, and `ReadLints` for edited code files.

## Guardrails
- No behavior, visual, or feature changes.
- Do not touch `src/features/trips/components/ansichten-sheet.tsx` or other sensor users.
- Do not extract or merge `getTripColumnId` strategies in this pass.
- If any replacement changes null or early-return behavior, stop and report before proceeding.