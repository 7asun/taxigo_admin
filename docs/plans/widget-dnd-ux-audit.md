# Widget DnD UX Audit

**Status: Implemented** (2026-06-25).

Changed files:

- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`
- `docs/trips/kanban-shared-utilities.md`
- `docs/plans/widget-dnd-ux-audit.md`

## Scope

Read-only audit of drag feel, visual feedback, and interaction quality differences between the main trips Kanban board and the overview widget board.

Files read completely before writing this document:

- `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`
- `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`
- `src/features/trips/components/kanban/kanban-board.tsx`
- `src/features/trips/components/kanban/kanban-column.tsx`
- `src/features/trips/components/kanban/kanban-trip-card.tsx`
- `src/features/trips/components/kanban/kanban-group-container.tsx`

Supporting read:

- `src/features/trips/components/kanban/kanban-drag-preview.tsx`

## 1. Drag Preview / DragOverlay

### Widget

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 166-180

```tsx
        {/*
         * DragOverlay is a sibling to the scroll container (not nested inside it).
         * dnd-kit portals the overlay, but tree position under DndContext still matters.
         * groupLabels={{}} is safe: KanbanDragPreview only reads groupLabels when
         * activeId.startsWith('group-'); widget v2 drags plain trip UUIDs only.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <KanbanDragPreview
              activeId={activeDragId}
              effectiveTrips={trips}
              groupLabels={{}}
            />
          ) : null}
        </DragOverlay>
```

Finding:

- The widget does have an equivalent `DragOverlay`.
- It renders `KanbanDragPreview`, the same styled preview component used by the main board.
- It is not a plain unstyled element.
- However, the widget passes `groupLabels={{}}`, so group drags render the styled group preview with the fallback label `Gruppe`, not the numbered `Gruppe N` label.
- The inline comment is now stale: it says widget v2 drags plain trip UUIDs only, but `TripsOverviewWidgetBoard.handleDragEnd` now handles `group-{id}` active ids at lines 82-110.

Supporting preview styling:

File: `src/features/trips/components/kanban/kanban-drag-preview.tsx`

Line range: 36-62

```tsx
    return (
      <div className='border-primary/25 bg-primary/5 flex w-72 flex-shrink-0 flex-col gap-1.5 rounded-lg border-2 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]'>
        <div className='text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase'>
          {groupLabels[groupId] ?? 'Gruppe'}
        </div>
        {groupTrips.slice(0, 2).map((trip) => (
          <div
            key={trip.id}
            className='bg-background rounded border p-2 text-xs'
          >
            <div className='font-medium'>
              {trip.scheduled_at
                ? format(new Date(trip.scheduled_at), 'HH:mm')
                : '--:--'}
            </div>
            <div className='line-clamp-1 text-[11px]'>
              {resolvePassengerLabel(trip)}
            </div>
          </div>
        ))}
        {groupTrips.length > 2 && (
          <div className='text-muted-foreground px-2 py-1 text-[10px]'>
            +{groupTrips.length - 2} weitere
          </div>
        )}
      </div>
    );
```

File: `src/features/trips/components/kanban/kanban-drag-preview.tsx`

Line range: 81-111

```tsx
  return (
    <Card
      style={style}
      className='bg-background flex w-72 flex-shrink-0 flex-col gap-1 rounded-md border p-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
    >
      <div className='flex min-w-0 items-center gap-2'>
        <span className='shrink-0 font-semibold tabular-nums'>
          {trip.scheduled_at
            ? format(new Date(trip.scheduled_at), 'HH:mm')
            : '--:--'}
        </span>
        <span className='min-w-0 flex-1 truncate text-[11px] font-medium'>
          {resolvePassengerLabel(trip)}
        </span>
      </div>
      <div className='text-muted-foreground flex flex-col gap-0.5 text-[11px]'>
        <p className='line-clamp-2 break-words'>
          <span className='text-foreground font-medium'>Ab: </span>
          {formatKanbanTripAddressLine(trip, 'pickup').trim() || '—'}
        </p>
        <p className='line-clamp-2 break-words'>
          <span className='text-foreground font-medium'>Nach: </span>
          {formatKanbanTripAddressLine(trip, 'dropoff').trim() || '—'}
        </p>
      </div>
      {payerName && (
        <Badge variant='outline' className='mt-1 px-1.5 py-0 text-[10px]'>
          {payerName}
        </Badge>
      )}
    </Card>
  );
```

### Main Board

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 690-707

```tsx
        {/*
         * DragOverlay must be fully controlled by dnd-kit for cursor tracking.
         * Do NOT add a transform style here — it overrides dnd-kit's own
         * translate3d that follows the pointer.
         * Instead, we zoom the inner content wrapper so the preview card
         * matches the board's visual scale.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div style={{ zoom }}>
              <KanbanDragPreview
                activeId={activeDragId}
                effectiveTrips={effectiveTrips}
                groupLabels={groupLabels}
              />
            </div>
          ) : null}
        </DragOverlay>
```

Gap:

- Main board passes live `groupLabels`.
- Main board wraps the preview in `<div style={{ zoom }}>`.
- Widget passes empty labels and does not wrap for scale.

## 2. Column Highlight

### Main Board

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 135-140

```tsx
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragColumnId, setActiveDragColumnId] = useState<string | null>(
    null
  );
  // why: isOver on the column droppable never fires when the pointer is over a child card droppable (pointerWithin always prefers the smallest target). We derive column hover state manually in onDragOver instead.
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 340-367

```tsx
  // why: Resolves the hovered column from any droppable under the pointer — card or column — so the column highlight activates regardless of what the pointer lands on.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id == null ? null : String(event.over.id);
      if (
        !overId ||
        overId.startsWith('column-') ||
        overId.startsWith('group-')
      ) {
        setDragOverColumnId(null);
        return;
      }

      const hoveredColumnId = resolveKanbanDropColumnId({
        overId,
        columns: effectiveColumns,
        trips: effectiveTrips,
        getTripColumnId
      });

      setDragOverColumnId(
        hoveredColumnId && hoveredColumnId !== activeDragColumnId
          ? hoveredColumnId
          : null
      );
    },
    [activeDragColumnId, effectiveColumns, effectiveTrips, getTripColumnId]
  );
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 659-664

```tsx
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
```

File: `src/features/trips/components/kanban/kanban-column.tsx`

Line range: 90-96

```tsx
  // True when a column header is being dragged (vs a trip card).
  const isColumnDrag = !!activeDragId?.startsWith('column-');
  // This column is the drop target for a column reorder.
  const isColumnDropTarget = isColumnDrag && isOver && !isDragging;
  // why: pointerWithin reports child card droppables instead of the column, so manual dragOverColumnId keeps cross-column card hovers visually aligned with column-move behavior.
  const shouldShowColumnBodyDropHighlight =
    (isOver || dragOverColumnId === column.id) && !isColumnDrag;
```

File: `src/features/trips/components/kanban/kanban-column.tsx`

Line range: 145-155

```tsx
      {/* Column body – tinted only for trip drops, not column reorder */}
      <div
        className='flex flex-1 flex-col gap-2 px-2 pt-2 pb-8'
        style={
          shouldShowColumnBodyDropHighlight
            ? {
                backgroundColor:
                  'color-mix(in srgb, var(--primary), transparent 92%)'
              }
            : undefined
        }
      >
```

### Widget

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 147-152

```tsx
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
```

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Line range: 45-46

```tsx
  const droppableId = column.id ?? 'unassigned';
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
```

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Line range: 62-67

```tsx
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 px-2 pt-2 pb-8',
          isOver && 'ring-primary/40 ring-2'
        )}
      >
```

Finding:

- The widget does not have an `onDragOver` handler.
- The widget tracks no hover-column state equivalent to `dragOverColumnId`.
- `TripsOverviewWidgetColumn` highlights only from `isOver` returned by `useDroppable`.
- Because collision detection is `pointerWithin`, child card droppables can win over the column droppable, so the widget can lose the column highlight exactly where the main board manually restores it.

## 3. Card-Level Highlight Suppression

### Main Board

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 334-338

```tsx
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    // why: Tracked so child cards can suppress their drop-target highlight when a cross-column drag passes over them.
    setActiveDragColumnId(event.active.data.current?.columnId ?? null);
  }, []);
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 673-684

```tsx
              <KanbanColumnView
                key={column.id}
                column={column}
                items={items}
                groupBy={groupBy}
                groupLabels={groupLabels}
                activeDragId={activeDragId}
                activeDragColumnId={activeDragColumnId}
                dragOverColumnId={dragOverColumnId}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
```

File: `src/features/trips/components/kanban/kanban-column.tsx`

Line range: 170-197

```tsx
          chunkItemsByGroup(items).map((chunk, chunkIdx) =>
            chunk.type === 'single' ? (
              <TripCard
                key={chunk.trips[0].id}
                trip={chunk.trips[0]}
                columnId={column.id}
                activeDragColumnId={activeDragColumnId}
                groupLabel={undefined}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
            ) : (
              <GroupedTripsContainer
                key={chunk.trips[0].group_id ?? chunkIdx}
                trips={chunk.trips}
                groupLabel={
                  chunk.trips[0]?.group_id
                    ? groupLabels[chunk.trips[0].group_id]
                    : undefined
                }
                columnId={column.id}
                activeDragColumnId={activeDragColumnId}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
            )
          )
```

File: `src/features/trips/components/kanban/kanban-trip-card.tsx`

Line range: 271-280

```tsx
  // why: Card-level highlight is only valid when the drag originates from the same column. Cross-column drags will result in a column move, not grouping — the column body highlight covers that case.
  const shouldShowCardDropHighlight = isOver && activeDragColumnId === columnId;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={setDroppableRef}
      className={cn(
        'relative',
        shouldShowCardDropHighlight && 'ring-primary/50 rounded-md ring-2'
      )}
```

### Widget

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 54-56

```tsx
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useKanbanSensors();
```

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Line range: 112-121

```tsx
            const card = (
              <TripCard
                trip={trip}
                columnId={column.id}
                groupLabel={undefined}
                disableDrag={isNonDraggable}
                onTimeChange={noopTimeChange}
                onStopOrderChange={noopStopOrderChange}
                onUngroup={noopUngroup}
              />
            );
```

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Line range: 79-89

```tsx
                <GroupedTripsContainer
                  key={groupId ?? chunkIdx}
                  trips={chunk.trips}
                  groupLabel={groupId ? groupLabels[groupId] : undefined}
                  columnId={column.id}
                  activeDragColumnId={null}
                  hideUngroupAction={true}
                  onTimeChange={noopTimeChange}
                  onStopOrderChange={noopStopOrderChange}
                  onUngroup={noopUngroup}
                />
```

File: `src/features/trips/components/kanban/kanban-trip-card.tsx`

Line range: 69-79

```tsx
export function TripCard({
  trip,
  columnId,
  activeDragColumnId = null,
  groupLabel,
  hideGroupBadge = false,
  disableDrag = false,
  onTimeChange,
  onStopOrderChange,
  onUngroup
}: TripCardProps) {
```

Finding:

- The widget does not track `activeDragColumnId`.
- The widget does not pass `activeDragColumnId` to direct single `TripCard`s, so they use the default `null`.
- The widget explicitly passes `activeDragColumnId={null}` to `GroupedTripsContainer`.
- Result: widget cards effectively never show the card-level drop highlight because `activeDragColumnId === columnId` is false for normal string column ids.

This avoids wrong card-level grouping highlights, but it also means the widget relies almost entirely on weaker column-level `isOver` highlighting.

## 4. Cursor During Drag

### Widget Board Container

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 145-153

```tsx
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
```

Finding: the widget applies no board-level cursor override such as `activeDragId && 'cursor-grabbing'`.

### Main Board Container

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 657-665

```tsx
    <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
      {/* pointerWithin prefers smaller droppables (trip cards) over columns. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
```

Finding: the main board also applies no board-level `activeDragId` cursor override.

### Draggable Element Cursor Styling

File: `src/features/trips/components/kanban/kanban-trip-card.tsx`

Line range: 283-290

```tsx
      <Card
        ref={disableDrag ? undefined : setDraggableRef}
        style={style}
        className={cn(
          'bg-background flex flex-col gap-1 rounded-md border p-2 text-xs shadow-none',
          !disableDrag && 'cursor-grab active:cursor-grabbing'
        )}
        {...(!disableDrag ? { ...listeners, ...attributes } : {})}
      >
```

File: `src/features/trips/components/kanban/kanban-group-container.tsx`

Line range: 80-84

```tsx
      <div
        className='flex cursor-grab items-center justify-between gap-2 px-1.5 py-0.5 active:cursor-grabbing'
        {...listeners}
        {...attributes}
      >
```

Finding:

- Neither board has a global cursor override while dragging.
- Both widget and main board inherit the same per-card and group-header cursor styling because they share `TripCard` and `GroupedTripsContainer`.
- This is not a widget-specific gap against the main board, but a possible quick polish item for both boards.

## 5. GroupedTripsContainer in Widget

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-column.tsx`

Line range: 79-89

```tsx
                <GroupedTripsContainer
                  key={groupId ?? chunkIdx}
                  trips={chunk.trips}
                  groupLabel={groupId ? groupLabels[groupId] : undefined}
                  columnId={column.id}
                  activeDragColumnId={null}
                  hideUngroupAction={true}
                  onTimeChange={noopTimeChange}
                  onStopOrderChange={noopStopOrderChange}
                  onUngroup={noopUngroup}
                />
```

File: `src/features/trips/components/kanban/kanban-group-container.tsx`

Line range: 106-119

```tsx
      {/* Individual cards */}
      {trips.map((trip) => (
        <TripCard
          key={trip.id}
          trip={trip}
          columnId={columnId}
          activeDragColumnId={activeDragColumnId}
          groupLabel={groupLabel}
          hideGroupBadge
          onTimeChange={onTimeChange}
          onStopOrderChange={onStopOrderChange}
          onUngroup={onUngroup}
        />
      ))}
```

Finding:

- Yes, the widget passes `activeDragColumnId={null}` to `GroupedTripsContainer`.
- `GroupedTripsContainer` passes that `null` through to every child `TripCard`.
- Because `TripCard` highlights only when `isOver && activeDragColumnId === columnId`, grouped cards in the widget do not show card-level drop highlights during drag.
- This is probably preferable to wrong highlights, but without robust column hover state it contributes to a flatter drag feel.

## 6. Touch Drag Feel

Both boards use the same shared sensor hook.

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 54-56

```tsx
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useKanbanSensors();
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 202-203

```tsx
  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useKanbanSensors();
```

### Main Board Scroll Container

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 657-669

```tsx
    <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
      {/* pointerWithin prefers smaller droppables (trip cards) over columns. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className='inline-flex min-h-[260px] min-w-max gap-3 p-3'
          style={{ zoom }}
        >
```

### Widget Scroll Container

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 153-165

```tsx
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
```

Finding:

- In the requested files, neither board adds explicit `touch-action`, `overscroll-*`, or drag-time scroll locking on the scroll container.
- The main board does have page scroll locking when expanded into a portal: `document.body.style.overflow = 'hidden'` at `kanban-board.tsx` lines 156-168. That is modal expansion behavior, not a per-drag touch rule.
- The visible scroll-container difference is layout rather than touch-specific: main uses one `overflow-auto` container and `min-w-0`; widget uses separate `overflow-x-auto overflow-y-auto` and lacks `min-w-0`.

## 7. Zoom / Scale

### Main Board

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 130-131

```tsx
  const [zoom, setZoom] = useState(1);
  const [columnOrderByMode, setColumnOrderByMode] = useState<
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 666-669

```tsx
        <div
          className='inline-flex min-h-[260px] min-w-max gap-3 p-3'
          style={{ zoom }}
        >
```

File: `src/features/trips/components/kanban/kanban-board.tsx`

Line range: 697-706

```tsx
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div style={{ zoom }}>
              <KanbanDragPreview
                activeId={activeDragId}
                effectiveTrips={effectiveTrips}
                groupLabels={groupLabels}
              />
            </div>
          ) : null}
```

### Widget

File: `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`

Line range: 145-180

```tsx
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
        {/*
         * DragOverlay is a sibling to the scroll container (not nested inside it).
         * dnd-kit portals the overlay, but tree position under DndContext still matters.
         * groupLabels={{}} is safe: KanbanDragPreview only reads groupLabels when
         * activeId.startsWith('group-'); widget v2 drags plain trip UUIDs only.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <KanbanDragPreview
              activeId={activeDragId}
              effectiveTrips={trips}
              groupLabels={{}}
            />
          ) : null}
        </DragOverlay>
```

Finding:

- The widget has no zoom state and no scale applied to the board content.
- Its `DragOverlay` does not account for scale difference because there is currently no widget-local scale difference to account for.
- The main board's zoom handling is not a missing widget feature unless the widget later gets scaling or lives inside a transformed parent.

## 8. Overall Gap List

Ranked from most impactful to least impactful on perceived drag quality:

### 1. Missing manual hover-column resolution in the widget

Evidence:

- Main board: `handleDragOver` and `dragOverColumnId` at `kanban-board.tsx` lines 135-140, 340-367, and `DndContext onDragOver` at lines 659-664.
- Main column: `shouldShowColumnBodyDropHighlight` uses `(isOver || dragOverColumnId === column.id)` at `kanban-column.tsx` lines 90-96.
- Widget: no `onDragOver` at `trips-overview-widget-board.tsx` lines 147-152; widget column highlights only `isOver` at `trips-overview-widget-column.tsx` lines 62-67.

Impact: high. This is the main reason the widget feels less responsive when dragging over existing cards or grouped stacks.

Recommendation:

- Meaningful change, not just 1-2 lines.
- Add `dragOverColumnId` and likely `activeDragColumnId` state to the widget board.
- Add `handleDragOver` mirroring the main board, using `resolveKanbanDropColumnId` with `resolveWidgetColumnId`.
- Pass `dragOverColumnId` to `TripsOverviewWidgetColumn` and use it alongside `isOver`.
- Risk: low to medium. It is visual feedback only, but must avoid highlighting the source column when not desired.

### 2. Widget has no active drag origin column tracking

Evidence:

- Main board tracks `activeDragColumnId` on drag start at `kanban-board.tsx` lines 334-338.
- Widget board tracks only `activeDragId` at `trips-overview-widget-board.tsx` lines 54 and 73-75.
- Widget single cards omit `activeDragColumnId` at `trips-overview-widget-column.tsx` lines 112-121.
- Widget group containers receive `activeDragColumnId={null}` at `trips-overview-widget-column.tsx` lines 79-89.

Impact: high to medium. It prevents wrong card highlights, but it also means the widget cannot reproduce the main board's more nuanced card-vs-column feedback.

Recommendation:

- Meaningful change if paired with column hover improvements.
- On drag start, use `event.active.data.current?.columnId` like the main board.
- Pass `activeDragColumnId` through `TripsOverviewWidgetColumn` to direct `TripCard`s and `GroupedTripsContainer`.
- Risk: medium. The widget intentionally uses no card-on-card grouping behavior, so enabling same-column card highlights may imply a grouping affordance that the widget does not support. If grouping is not supported in the widget, prefer column-only highlighting and keep card highlights suppressed.

### 3. Group drag preview has stale label data and stale comment

Evidence:

- Widget `DragOverlay` passes `groupLabels={{}}` at `trips-overview-widget-board.tsx` lines 172-179.
- The comment still claims widget v2 drags plain trip UUIDs only at lines 169-170.
- `KanbanDragPreview` reads `groupLabels[groupId] ?? 'Gruppe'` for group previews at `kanban-drag-preview.tsx` lines 36-40.
- Widget now handles `group-{id}` active ids at `trips-overview-widget-board.tsx` lines 82-110.

Impact: medium. The preview is styled, but group previews lose the numbered group label and the comment is misleading.

Recommendation:

- Quick fix.
- Pass `groupLabels={groupLabels}` to the widget `KanbanDragPreview`.
- Update or remove the stale comment.
- Risk: very low. `groupLabels` is already computed in the same component at line 71.

### 4. Widget column highlight style differs from main board

Evidence:

- Main board uses a subtle background tint on the column body at `kanban-column.tsx` lines 145-155.
- Widget uses `ring-primary/40 ring-2` on the column body at `trips-overview-widget-column.tsx` lines 62-67.

Impact: medium. Even when the widget highlight appears, it feels different from the main board and may look harsher or less integrated.

Recommendation:

- Quick fix if only styling is changed after adding hover state.
- Use the same background tint style as the main board or align the visual language deliberately.
- Risk: low. Visual-only, but it changes widget appearance.

### 5. No board-level cursor override while dragging

Evidence:

- Widget board container has no `activeDragId` cursor class at `trips-overview-widget-board.tsx` lines 145-153.
- Main board container also has no `activeDragId` cursor class at `kanban-board.tsx` lines 657-665.
- Shared draggable elements use `cursor-grab active:cursor-grabbing` in `TripCard` at `kanban-trip-card.tsx` lines 283-290 and group header at `kanban-group-container.tsx` lines 80-84.

Impact: low. This is not a gap between widget and main board, but a shared polish opportunity.

Recommendation:

- Quick fix, but should be considered for both boards if desired.
- Add conditional `cursor-grabbing` at a high-level DnD container while `activeDragId` is set.
- Risk: low. Could interfere with nested clickable controls if over-applied.

### 6. Scroll container differences may affect touch feel, but no explicit touch handling gap exists in requested files

Evidence:

- Main scroll container: `min-h-0 min-w-0 flex-1 overflow-auto` at `kanban-board.tsx` line 657.
- Widget scroll container: `min-h-0 flex-1 overflow-x-auto overflow-y-auto` at `trips-overview-widget-board.tsx` line 153.
- Neither requested board scroll container uses explicit `touch-action` or `overscroll-*`.

Impact: low to uncertain. Sensor behavior is shared, and no direct touch-specific advantage exists in the main board code shown here.

Recommendation:

- Defer unless touch testing shows concrete scroll/drag conflict.
- If needed, audit the surrounding dialog and mobile layout before changing touch CSS.
- Risk: medium if changing `touch-action`, because it can break scrolling.

### 7. Zoom handling differs, but it is not currently a widget gap

Evidence:

- Main board has zoom state and applies it to content and overlay at `kanban-board.tsx` lines 130-131, 666-669, and 697-706.
- Widget has no zoom or scale in `trips-overview-widget-board.tsx` lines 145-180.

Impact: low. The widget does not expose zoom, so there is no current scale mismatch to fix.

Recommendation:

- No change now.
- If the widget is later rendered inside a transformed/scaled container, add a scale-aware overlay wrapper like the main board.
- Risk: low if introduced only when scale exists.

## Senior Recommendation Summary

1. First fix the widget's missing `onDragOver` / `dragOverColumnId` path. This is the highest-impact improvement and directly mirrors the main board's solved problem.
2. Decide deliberately whether the widget should ever show card-level highlights. If the widget does not support card-on-card grouping, keep `TripCard` highlights suppressed and rely on stronger column highlighting.
3. Pass real `groupLabels` to `KanbanDragPreview` in the widget and update the stale overlay comment. This is a quick, low-risk correctness/polish fix.
4. Align the widget column highlight styling with the main board's background tint after the hover state is reliable.
5. Leave touch CSS and zoom handling alone until there is evidence of an actual issue in the widget context.

