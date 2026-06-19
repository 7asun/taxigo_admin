---
name: kts reha indicator
overview: Add a default-visible KTS-cell overlap indicator for trips where KTS and Reha-Schein are both active, while keeping switch behavior, row highlighting, mobile cards, and unrelated columns unchanged.
todos:
  - id: trip-row-type
    content: Create shared TripRow type and update existing type-only imports without behavior changes
    status: completed
  - id: flag-helper
    content: Add pure hasKtsRehaOverlap helper in trip-assignment-flags.ts
    status: completed
  - id: indicator-component
    content: Add accessible amber AssignmentConflictIndicator component
    status: completed
  - id: barrel-and-column
    content: Export indicator and wire it into only the KTS column with no layout shift
    status: completed
  - id: docs-validation
    content: Update relevant docs and run requested build/test gates
    status: completed
isProject: false
---

# KTS/Reha Overlap Indicator Plan

## Scope
Implement the overlap signal in the desktop trips table KTS column only. The change will preserve existing KTS/Reha switch behavior and use a pure trip-domain helper for the overlap rule.

Files to change:
- [`src/features/trips/types/trip-row.ts`](src/features/trips/types/trip-row.ts) — new shared row type currently embedded in [`src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`](src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx).
- [`src/features/trips/lib/trip-assignment-flags.ts`](src/features/trips/lib/trip-assignment-flags.ts) — new pure helper with `hasKtsRehaOverlap(trip: TripRow): boolean`.
- [`src/features/trips/components/trips-tables/inline-cells/assignment-conflict-indicator.tsx`](src/features/trips/components/trips-tables/inline-cells/assignment-conflict-indicator.tsx) — new presentational amber tooltip/icon component.
- [`src/features/trips/components/trips-tables/inline-cells/index.ts`](src/features/trips/components/trips-tables/inline-cells/index.ts) — export the new indicator only.
- [`src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`](src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx) and [`src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx`](src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx) — type-only import boundary update for `TripRow`; no component behavior changes.
- [`src/features/trips/components/trips-tables/columns.tsx`](src/features/trips/components/trips-tables/columns.tsx) — wire the indicator into the `kts_document_applies` cell only.
- [`docs/trips-inline-editing.md`](docs/trips-inline-editing.md) and [`docs/plans/kts-reha-overlap-indicator-audit.md`](docs/plans/kts-reha-overlap-indicator-audit.md) — document the helper, indicator, placement, and rule.

## Key Findings From Read-Through
- `TripRow` currently lives in `kts-cells.tsx`, not `src/features/trips/types/trip-row.ts`.
- `RehaScheinSwitchCell` imports `TripRow` from `./kts-cells`, so moving the type into `src/features/trips/types/trip-row.ts` improves boundaries with no behavior change.
- The KTS column currently renders only:

```tsx
<KtsCellGroupProvider key={row.original.id} trip={row.original}>
  <KtsSwitchCell trip={row.original} />
</KtsCellGroupProvider>
```

- `KtsCellGroupProvider` returns a React context provider only, so it does not create DOM or `overflow-hidden` clipping.
- The table cell wrapper uses `position: relative` and no `overflow-hidden`; `TableCell` uses padding/whitespace only. A fixed-width inner cell wrapper with an absolutely positioned indicator is feasible.
- Reha is hidden by default in `TripsTable.initialState.columnVisibility`, so the indicator must live in the visible KTS column.

## Implementation Steps
1. Create [`src/features/trips/types/trip-row.ts`](src/features/trips/types/trip-row.ts) with the existing row shape: `Trip & { payer: { name: string; reha_schein_enabled: boolean } | null }`. Update `kts-cells.tsx` and `reha-cells.tsx` to import this type only; do not touch switch logic.
2. Create [`src/features/trips/lib/trip-assignment-flags.ts`](src/features/trips/lib/trip-assignment-flags.ts) with only `hasKtsRehaOverlap(trip: TripRow): boolean`. Add a short why comment separating trip state flags from `kts-filter.ts` URL semantics.
3. Create [`assignment-conflict-indicator.tsx`](src/features/trips/components/trips-tables/inline-cells/assignment-conflict-indicator.tsx). It will accept `{ trip: TripRow }`, call `hasKtsRehaOverlap`, return `null` when false, and render an amber `AlertTriangle` tooltip when true. Include accessible text via `aria-label` or `sr-only`, and a why comment for `null` output plus amber/non-destructive styling.
4. Export `AssignmentConflictIndicator` from [`inline-cells/index.ts`](src/features/trips/components/trips-tables/inline-cells/index.ts), keeping existing exports intact.
5. Update only the `kts_document_applies` cell in [`columns.tsx`](src/features/trips/components/trips-tables/columns.tsx). Import `AssignmentConflictIndicator` from `./inline-cells`, keep the provider, and add a fixed-width relative wrapper so the KTS switch stays centered in the same position whether or not the indicator renders. Place the icon absolutely in the wrapper corner after `KtsSwitchCell`, with a why comment about default visibility and no layout shift. The fixed-width wrapper must match the current rendered width of the KTS cell so that the column width does not change. Cursor must measure or inspect the current cell width before choosing a value; do not hardcode an arbitrary px width. This prevents the column from silently widening on rows that never show the indicator.
6. Update docs: `docs/trips-inline-editing.md` for the new type/helper/component pattern, and `docs/plans/kts-reha-overlap-indicator-audit.md` with the implemented direction and explicit overlap rule.

## Validation
Run the requested gates in order during implementation:
- `bun run build` after the type/helper step.
- `bun run build` after adding the indicator component and barrel export.
- `bun run build` after wiring the KTS column.
- Final `bun run build` and `bun test`.

Also run `ReadLints` on edited files after substantive edits and fix introduced diagnostics if any appear.

## Non-Goals
No changes to KTS/Reha mutations, optimistic state, shared switch behavior, row-level `getRowClassName`, Reha column rendering, KTS-Fehler columns, mobile cards, or filter semantics in `kts-filter.ts`.