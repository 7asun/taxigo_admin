# KTS/Reha Overlap Indicator Audit

## 1. Column Structure

The trips list server component imports the desktop table and columns from `src/features/trips/components/trips-tables/index.tsx`, not from a singular `trips-table.tsx` file. `src/features/trips/components/trips-listing.tsx:10` imports `TripsTable, columns`, and `src/features/trips/components/trips-listing.tsx:374-380` passes `columns={columns}` into `<TripsTable />`.

The table implementation lives in `src/features/trips/components/trips-tables/index.tsx`. It imports and re-exports the columns at `src/features/trips/components/trips-tables/index.tsx:10` and `src/features/trips/components/trips-tables/index.tsx:23`.

The KTS and Reha fields are separate TanStack columns in `src/features/trips/components/trips-tables/columns.tsx`, not combined into one shared visible cell:

```tsx
{
  id: 'kts_document_applies',
  accessorKey: 'kts_document_applies',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='KTS' />
  ),
  cell: ({ row }) => (
    <KtsCellGroupProvider key={row.original.id} trip={row.original}>
      <KtsSwitchCell trip={row.original} />
    </KtsCellGroupProvider>
  ),
  meta: { label: 'KTS', variant: 'text' },
  enableColumnFilter: false
}
```

Reference: `src/features/trips/components/trips-tables/columns.tsx:513-526`.

```tsx
{
  id: 'kts_fehler',
  accessorKey: 'kts_fehler',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='KTS-Fehler' />
  ),
  cell: ({ row }) => (
    <KtsCellGroupProvider key={row.original.id} trip={row.original}>
      <KtsFehlerSwitchCell trip={row.original} />
    </KtsCellGroupProvider>
  ),
  meta: { label: 'KTS-Fehler', variant: 'text' },
  enableColumnFilter: false
}
```

Reference: `src/features/trips/components/trips-tables/columns.tsx:527-540`.

```tsx
{
  id: 'reha_schein',
  accessorKey: 'reha_schein',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Reha' />
  ),
  cell: ({ row }) => <RehaScheinSwitchCell trip={row.original} />,
  meta: { label: 'Reha-Schein', variant: 'text' },
  enableColumnFilter: false
}
```

Reference: `src/features/trips/components/trips-tables/columns.tsx:555-564`.

Important visibility note: the Reha column is hidden by default. `TripsTable` sets `initialState.columnVisibility.reha_schein = false` at `src/features/trips/components/trips-tables/index.tsx:55-61`. So an indicator that lives only in the Reha column would not be visible in the default desktop table.

## 2. Cell Renderer — Current Appearance

The desktop KTS cell renders a centered shadcn `Switch`. It has no badge, icon, text label, border, or warning state. The switch uses `aria-label='KTS vorhanden'`.

Reference: `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx:201-224`.

The KTS-Fehler cell is also a centered `Switch` when KTS is active. If KTS is not active, it renders a muted em dash. The switch uses `aria-label='KTS-Fehler vorhanden'`.

References: `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx:227-255`.

The KTS-Fehler text cell renders a muted em dash, a tooltip-wrapped truncated text, or an inline text input depending on KTS/KTS-Fehler state.

References: `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx:258-326`.

The desktop Reha cell renders a centered shadcn `Switch` when the payer has `reha_schein_enabled`. If the payer is not Reha-enabled, it renders a muted em dash. The switch uses `aria-label='Reha-Schein vorhanden'`.

References: `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx:11-42`.

Existing visual indicator patterns in columns include:

- Status is a `Badge` using `tripStatusBadge({ status })` at `src/features/trips/components/trips-tables/columns.tsx:286-305`.
- Wheelchair uses a small outline `Badge` with an `Accessibility` icon and rose colors at `src/features/trips/components/trips-tables/columns.tsx:172-190`.
- Recurring trips use a small blue `RepeatIcon` next to time at `src/features/trips/components/trips-tables/columns.tsx:142-156`.
- Urgency uses a small dot in the time cell at `src/features/trips/components/trips-tables/columns.tsx:144-153`, backed by tooltip/motion styles in `src/features/trips/components/urgency-indicator.tsx:99-180`.
- Fremdfirma billing uses a compact tooltip-wrapped secondary `Badge` at `src/features/trips/components/trips-tables/columns.tsx:393-422`.

The narrow/mobile card list is separate from the desktop cell renderers. It currently shows a small `KTS` secondary badge when `trip.kts_document_applies` is true at `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx:160-168`; it does not show Reha or overlap.

## 3. Row-Level Data Access

The column definitions have access to the full TanStack row. The KTS and Reha column cells receive `row`, then pass `row.original` into their renderers:

- KTS: `cell: ({ row }) => ... trip={row.original}` at `src/features/trips/components/trips-tables/columns.tsx:519-523`.
- KTS-Fehler: `cell: ({ row }) => ... trip={row.original}` at `src/features/trips/components/trips-tables/columns.tsx:533-537`.
- Reha: `cell: ({ row }) => <RehaScheinSwitchCell trip={row.original} />` at `src/features/trips/components/trips-tables/columns.tsx:561`.

Because `row.original` is the full trip row, a KTS cell renderer can read `reha_schein`, and a Reha cell renderer can read `kts_document_applies`, as long as the renderer receives the trip object. The current standalone component prop type supports this: `TripRow` extends `Trip` and includes the payer embed at `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx:20-23`; `RehaScheinSwitchCell` imports that same `TripRow` type at `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx:7-11`.

The server query also selects both booleans via `*`, plus the payer embed needed by the Reha gate. The list select is defined at `src/features/trips/components/trips-listing.tsx:94-101`.

## 4. Existing Highlight Patterns

Row-level highlighting already exists and is centralized in `TripsTable.getRowClassName`.

Implementation:

```tsx
const getRowClassName = (row: any) => {
  const classes: string[] = [];

  const scheduledAt = row.scheduled_at;
  const status = row.status;
  const urgency = getUrgencyLevel(scheduledAt, status);
  const style = URGENCY_STYLES[urgency];

  if (row.group_id && groupCounts[row.group_id] > 1) {
    classes.push(
      'border-l-4 border-l-green-500 bg-green-50/10 dark:bg-green-950/5'
    );
  } else if (style && style.rowClass) {
    classes.push(style.rowClass);
  }

  if (scheduledAt) {
    const date = new Date(scheduledAt);
    if (isToday(date)) {
      classes.push('bg-muted/10');
    }
  }

  return cn(classes);
};
```

Reference: `src/features/trips/components/trips-tables/index.tsx:136-160`.

The row class is applied to desktop `<TableRow>` by the generic table component at `src/components/ui/table/data-table.tsx:149-167`.

The same `getRowClassName` is passed into the mobile card list at `src/features/trips/components/trips-tables/index.tsx:170-180`, and mobile applies it to `<Card className={cn(..., rowClass)}>` at `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx:84-93`.

The configured urgency row classes use a left border plus very subtle background tint:

- Upcoming: `border-l-4 border-l-blue-500 bg-blue-50/10 dark:bg-blue-950/5` at `src/features/trips/constants/urgency-config.ts:26-32`.
- Imminent: `border-l-4 border-l-amber-500 bg-amber-50/10 dark:bg-amber-950/5` at `src/features/trips/constants/urgency-config.ts:33-39`.
- Due: `border-l-4 border-l-red-500 bg-red-50/20 dark:bg-red-950/10 font-medium` at `src/features/trips/constants/urgency-config.ts:40-47`.
- Overdue: `border-l-4 border-l-red-600 bg-red-50/30 dark:bg-red-950/15 font-bold animate-pulse` at `src/features/trips/constants/urgency-config.ts:48-55`.

Grouped trips also use the same left-border plus tint idiom, but green, at `src/features/trips/components/trips-tables/index.tsx:144-147`.

Cell-level highlight/warning patterns are lighter and icon/badge based rather than cell-border based: urgency dot, wheelchair badge, recurring icon, status badges, and Fremdfirma badge. I found no existing KTS/Reha-specific warning pattern and no existing destructive ring around a table cell.

## 5. Component Boundaries

The column definitions are inline in `src/features/trips/components/trips-tables/columns.tsx`, but KTS/Reha rendering is delegated to standalone components:

- `KtsSwitchCell`, `KtsFehlerSwitchCell`, `KtsFehlerTextCell`, and `KtsCellGroupProvider` live in `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`.
- `RehaScheinSwitchCell` lives in `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx`.
- `src/features/trips/components/trips-tables/inline-cells/index.ts:1-6` exports the inline-cell components through a small barrel.

Adding an overlap indicator could be done in only the KTS column definition by wrapping `KtsSwitchCell` in a small indicator container and checking `row.original.kts_document_applies && row.original.reha_schein`. That would avoid changing shared switch behavior.

If the indicator should follow optimistic toggles immediately, then the standalone cell components become relevant. KTS optimistic state is shared across KTS-related cells through trip-id stores in `kts-cells.tsx` at `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx:25-199`. Reha has local-only optimistic state in `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx:14-19`. A row-original-only indicator would update after server refresh or parent data update, but not necessarily during Reha's local optimistic window.

## 6. Senior Recommendation — Approach + Risks

Least invasive approach: add a small warning icon or compact warning badge inside the visible KTS column when both `row.original.kts_document_applies` and `row.original.reha_schein` are true. The KTS column is visible by default, while Reha is hidden by default at `src/features/trips/components/trips-tables/index.tsx:55-61`, so a Reha-only indicator would miss the stated goal.

Placement: prefer the KTS cell only. Showing the same warning in both KTS and Reha would be redundant, and the Reha column may be hidden. A dedicated column would add column-management overhead for a narrow reconciliation signal and would be more invasive than needed.

Visual style: prefer a small amber warning icon or tiny amber outline/secondary badge next to the KTS switch, with a tooltip such as "KTS und Reha-Schein gleichzeitig aktiv". This matches existing cell-level patterns: status badges, wheelchair icon badge, recurring icon, urgency dot, and tooltip-backed compact badges. Avoid a destructive-colored ring/border on the cell unless product wants this treated as an error. Avoid row-level background tint as the first step because row-level tint/left-border is already used for grouping and time urgency; adding another row-level state would require priority decisions against `group_id` and `URGENCY_STYLES`.

Risks:

- Visibility: Reha is hidden by default, so the indicator must live in a default-visible area, most likely KTS or the passenger/time cluster.
- Priority collisions: row-level highlighting currently gives grouped trips priority over urgency via `if (...) else if (...)` at `src/features/trips/components/trips-tables/index.tsx:144-150`; adding overlap there would require a deliberate precedence rule.
- Optimistic state: a simple `row.original` check is stable and cheap, but may not reflect a just-toggled Reha/KTS overlap until data refresh. Immediate optimistic accuracy would require passing overlap state into or between the KTS/Reha inline cell components.
- Accessibility: an icon-only indicator needs a tooltip plus accessible label or screen-reader text. Existing switches already have field-specific `aria-label`s, so the warning should not replace those labels.
- Performance: a boolean check per visible row is negligible. Avoid adding intervals or global stores; the urgency system already uses a 10s interval for time-dependent state, but this overlap signal is static row data.

## Proposed Implementation Direction

Cursor recommends adding a compact amber warning indicator in the default-visible KTS cell, immediately adjacent to `KtsSwitchCell`, when `row.original.kts_document_applies && row.original.reha_schein` is true. Implement it in the KTS column wrapper or a very small KTS-specific cell wrapper, with tooltip/accessibility text, and leave row-level `getRowClassName` untouched unless the admin team later asks for a stronger alert. This keeps the change localized, avoids conflicts with existing row urgency/group highlights, and still makes overlap cases visible without requiring filters or showing the hidden Reha column.

---

## Implementation Status (applied)

**Implemented.** All changes are in the current workspace.

### Overlap rule

`kts_document_applies === true AND reha_schein === true`

Single source of truth: `hasKtsRehaOverlap(trip)` in `src/features/trips/lib/trip-assignment-flags.ts`.

### New shared type

`src/features/trips/types/trip-row.ts` — extracted the `TripRow` type that was previously inlined in `kts-cells.tsx`. Both `kts-cells.tsx` and `reha-cells.tsx` now import from this shared file. The pure helper imports from here without pulling in any React dependencies.

### New pure helper

`src/features/trips/lib/trip-assignment-flags.ts` — exports `hasKtsRehaOverlap`. Zero side effects, no React imports, no URL semantics. The file comment explains the separation from `kts-filter.ts`.

### New indicator component

`src/features/trips/components/trips-tables/inline-cells/assignment-conflict-indicator.tsx` — exported from the barrel at `inline-cells/index.ts`. Behaviour:

- Returns `null` when no overlap → zero DOM output on non-overlap rows.
- Renders a small amber Lucide `AlertTriangle` (`size-3`, `text-amber-500 dark:text-amber-400`) absolutely positioned in the top-right corner of the KTS cell wrapper.
- Tooltip content (German): `"KTS und Reha-Schein gleichzeitig aktiv"`.
- `aria-label` and `sr-only` text carry the same string for accessibility.

### Column wire-up

Only the `kts_document_applies` cell in `src/features/trips/components/trips-tables/columns.tsx` was changed. A `div.relative` wrapper was added around `KtsCellGroupProvider`. The wrapper carries a comment explaining the width measurement (Switch `w-8` = 32px + `px-1` = 8px → 40px) and why `relative` alone is sufficient (no intrinsic width, indicator is `absolute` and out of flow).

### Deferred (unchanged)

- Mobile card list overlap indicator.
- Row-level background tint or left-border for overlap rows.
- Optimistic state synchronisation during live KTS/Reha toggles.
- Additional flag functions in `trip-assignment-flags.ts`.
