# Kanban Grouping Column Guard Audit

## Scope Read

- `/dashboard/trips` is the Fahrten route equivalent. The route entry is `src/app/dashboard/trips/page.tsx`, with sibling route files in `src/app/dashboard/trips/`.
- The rendered Fahrten listing loads `TripsListingPage` from `src/features/trips/components/trips-listing.tsx`; Kanban mode renders `TripsKanbanBoard`.
- All requested filename matches under `src/components/` and `src/features/` containing `kanban`, `board`, `card`, `group`, `drag`, or `dnd` were read. Top-level `components/` and `features/` folders do not exist in this repo.
- The trip type source is `src/features/trips/api/trips.service.ts`, which aliases `Trip` to `Database['public']['Tables']['trips']['Row']` from `src/types/database.types.ts`.

## 1. DnD Structure

Packages present in `package.json`:

- `@dnd-kit/core`
- `@dnd-kit/modifiers`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

Packages used by the Fahrten Kanban board:

- `@dnd-kit/core`: `DndContext`, `DragOverlay`, sensors, `pointerWithin`, `useDraggable`, `useDroppable`.
- `@dnd-kit/utilities`: `CSS.Translate.toString(...)`.
- `@dnd-kit/sortable`: not used by the Fahrten Kanban board. It is used by table column dragging in `src/components/ui/table/draggable-column.tsx`.

`DndContext` for the Fahrten Kanban board is defined in `src/features/trips/components/kanban/kanban-board.tsx`, inside `TripsKanbanBoard`, around lines 591-639:

```591:639:src/features/trips/components/kanban/kanban-board.tsx
    <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
      {/* pointerWithin prefers smaller droppables (trip cards) over columns. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className='inline-flex min-h-[260px] min-w-max gap-3 p-3'
          style={{ zoom }}
        >
          {effectiveColumns.map((column) => {
            const items = itemsByColumn[column.id] ?? [];
            return (
              <KanbanColumnView
                key={column.id}
                column={column}
                items={items}
                groupBy={groupBy}
                groupLabels={groupLabels}
                activeDragId={activeDragId}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
            );
          })}
        </div>

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
      </DndContext>
    </div>
```

There is one unified `DndContext` for the whole board. Columns and cards are separate draggable/droppable elements inside that one context, not separate sortable contexts:

- Columns: `KanbanColumnView` uses `useDroppable({ id: column.id })` for the column body and `useDraggable({ id: \`column-${column.id}\`, data: { columnId: column.id } })` for column header reordering.
- Cards: `TripCard` uses `useDroppable({ id: \`trip-${trip.id}\` })` for trip-on-trip grouping and `useDraggable({ id: trip.id, data: { tripId: trip.id, columnId } })` for card dragging.
- Groups: `GroupedTripsContainer` uses `useDraggable({ id: \`group-${groupId}\`, data: { groupId, tripIds } })` for dragging a whole group.

There is no `SortableContext` in the Fahrten Kanban implementation.

## 2. Grouping Trigger

Grouping is invoked in `src/features/trips/components/kanban/kanban-board.tsx`, function `TripsKanbanBoard`, inside the `handleDragEnd` callback.

Relevant line range: 346-489 for the whole handler, and 401-435 for the grouping branch:

```346:435:src/features/trips/components/kanban/kanban-board.tsx
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over) return;

      const draggedId = String(active.id);
      const overStr = String(over.id);
      const isDraggingGroup = draggedId.startsWith('group-');

      // 1. Column reorder
      // pointerWithin may report a trip-card droppable (trip-{id}) as `over`
      // instead of the column droppable when the pointer lands on a card inside
      // the target column. Resolve the actual target column in both cases.
      if (draggedId.startsWith('column-')) {
        // ...
        return;
      }

      // 2. Trip → trip: grouping
      if (!isDraggingGroup && overStr.startsWith('trip-')) {
        const targetId = overStr.replace(/^trip-/, '');
        if (targetId === draggedId) return;

        const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
        const targetTrip = effectiveTrips.find((t) => t.id === targetId);
        if (!draggedTrip || !targetTrip) return;

        const targetGroupId = targetTrip.group_id ?? crypto.randomUUID();
        const groupTrips = effectiveTrips.filter(
          (t) =>
            (t.group_id ?? (t.id === targetId ? targetGroupId : null)) ===
            targetGroupId
        );
        const maxStop = targetTrip.group_id
          ? Math.max(...groupTrips.map((t) => t.stop_order ?? 0), 0)
          : 1;
        const newStopOrder = maxStop + 1;

        setPendingChanges((prev) => {
          const next = { ...prev };
          const draggedChange = next[draggedId] ?? {};
          draggedChange.group_id = targetGroupId;
          draggedChange.stop_order = newStopOrder;
          next[draggedId] = draggedChange;
          if (!targetTrip.group_id) {
            const targetChange = next[targetId] ?? {};
            targetChange.group_id = targetGroupId;
            targetChange.stop_order = 1;
            next[targetId] = targetChange;
          }
          return next;
        });
        return;
      }
```

It is not inside `onDragOver`. It is not inside a custom collision detection function. It runs only in `onDragEnd`.

Current condition that decides grouping vs. column move:

- Grouping: `!isDraggingGroup && overStr.startsWith('trip-')`.
- Column move: any non-column drag that does not enter the grouping branch falls through to the assignment branch at lines 438-488.

The current grouping condition only checks whether the final `over.id` is a trip-card droppable. It does not check source and target column identity.

## 3. Column Identity During Drag

At the grouping decision point, both trips are available:

- Source trip variable: `draggedTrip`
- Target trip variable: `targetTrip`

Those variables are loaded from `effectiveTrips` in `handleDragEnd`:

```406:408:src/features/trips/components/kanban/kanban-board.tsx
        const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
        const targetTrip = effectiveTrips.find((t) => t.id === targetId);
        if (!draggedTrip || !targetTrip) return;
```

The direct source card column ID is also attached to the draggable data in `TripCard`:

```124:127:src/features/trips/components/kanban/kanban-trip-card.tsx
  } = useDraggable({
    id: trip.id,
    data: { tripId: trip.id, columnId }
  });
```

However, `handleDragEnd` currently does not read `active.data.current?.columnId`.

The target card's column ID is not attached to the target card droppable data. `TripCard` currently registers the droppable like this:

```113:116:src/features/trips/components/kanban/kanban-trip-card.tsx
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `trip-${trip.id}`
  });
```

Column membership is currently tracked by the trip fields used by `buildItemsByColumn`:

```135:146:src/features/trips/lib/kanban-columns.ts
  for (const trip of trips) {
    const columnId =
      groupBy === 'driver'
        ? (trip.driver_id ?? 'unassigned')
        : groupBy === 'status'
          ? trip.status
          : (trip.payer_id ?? 'no_payer');

    if (!itemsByColumn[columnId]) {
      itemsByColumn[columnId] = [];
    }
    itemsByColumn[columnId].push(trip);
  }
```

So at the grouping decision point:

- Source column can be read from `active.data.current?.columnId`, or derived from `draggedTrip` and `groupBy`.
- Target column can be derived from `targetTrip` and `groupBy`.
- Target column is not currently available as `over.data.current?.columnId`.

## 4. Data Model

Grouping is represented by `group_id` and ordered by `stop_order` on the `trips` row. There is no `parent_id` field in the generated `trips` type.

Generated Supabase row type:

```1477:1564:src/types/database.types.ts
      trips: {
        Row: {
          actual_dropoff_at: string | null;
          actual_pickup_at: string | null;
          billing_betreuer: string | null;
          billing_calling_station: string | null;
          billing_variant_id: string | null;
          kts_document_applies: boolean;
          kts_fehler: boolean;
          kts_fehler_beschreibung: string | null;
          kts_handover_id: string | null;
          kts_patient_id: string | null;
          kts_belegnummer: string | null;
          kts_invoice_amount: number | null;
          kts_eigenanteil: number | null;
          kts_external_invoice_id: string | null;
          kts_ruecklaufer_reason: string | null;
          kts_source: string | null;
          kts_status: Database['public']['Enums']['kts_status'] | null;
          reha_schein: boolean;
          fremdfirma_cost: number | null;
          fremdfirma_id: string | null;
          fremdfirma_payment_mode: string | null;
          no_invoice_required: boolean;
          no_invoice_source: string | null;
          selbstzahler_collected_amount: number | null;
          client_id: string | null;
          client_name: string | null;
          client_phone: string | null;
          company_id: string | null;
          created_at: string | null;
          created_by: string | null;
          driver_id: string | null;
          dropoff_address: string | null;
          dropoff_lat: number | null;
          dropoff_lng: number | null;
          dropoff_city: string | null;
          dropoff_street: string | null;
          dropoff_street_number: string | null;
          dropoff_zip_code: string | null;
          driving_distance_km: number | null;
          driving_duration_seconds: number | null;
          dropoff_location: Json | null;
          dropoff_station: string | null;
          dropoff_place_id: string | null;
          greeting_style: string | null;
          has_missing_geodata: boolean;
          group_id: string | null;
          id: string;
          ingestion_source: string | null;
          is_wheelchair: boolean;
          link_type: string | null;
          linked_trip_id: string | null;
          note: string | null;
          notes: string | null;
          needs_driver_assignment: boolean;
          canceled_reason_notes: string | null;
          payer_id: string | null;
          payment_method: string | null;
          pickup_address: string | null;
          pickup_lat: number | null;
          pickup_lng: number | null;
          pickup_city: string | null;
          pickup_street: string | null;
          pickup_street_number: string | null;
          pickup_zip_code: string | null;
          pickup_location: Json | null;
          pickup_station: string | null;
          pickup_place_id: string | null;
          /** Generated STORED: COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0). Read-only; omit from writes. */
          net_price: number;
          gross_price: number | null;
          tax_rate: number | null;
          base_net_price: number | null;
          approach_fee_net: number | null;
          manual_distance_km: number | null;
          manual_gross_price: number | null;
          manual_tax_rate: number | null;
          billing_type_id: string | null;
          requested_date: string | null;
          return_status: string | null;
          rule_id: string | null;
          scheduled_at: string | null;
          status: string;
          stop_order: number | null;
          stop_updates: Json;
          vehicle_id: string | null;
        };
```

Local Kanban staging mirrors the DB fields:

```15:22:src/features/trips/stores/use-kanban-pending-store.ts
export type KanbanPendingChange = {
  driver_id?: string | null;
  status?: string;
  payer_id?: string | null;
  scheduled_at?: string | null;
  group_id?: string | null;
  stop_order?: number | null;
};
```

`KanbanTrip` also exposes `group_id` and `stop_order`:

```11:28:src/features/trips/lib/kanban-types.ts
/** A single trip enriched with joined relations used on the board. */
export type KanbanTrip = Trip & {
  payer?: {
    name?: string | null;
    reha_schein_enabled?: boolean;
  } | null;
  /** Joined billing leaf + parent family (color/display). */
  billing_variant?: {
    id?: string;
    name?: string | null;
    code?: string | null;
    billing_types?: { name?: string | null; color?: string | null } | null;
  } | null;
  driver?: { name?: string | null } | null;
  group_id?: string | null;
  stop_order?: number | null;
  requested_date?: string | null;
};
```

The persisted write happens on save. `handleSave` copies staged `group_id` and `stop_order` into the `UpdateTrip` payload and calls `tripsService.updateTrip`:

```522:534:src/features/trips/components/kanban/kanban-board.tsx
        if (change.payer_id !== undefined) payload.payer_id = change.payer_id;
        if (change.scheduled_at !== undefined)
          payload.scheduled_at = change.scheduled_at;
        if (change.group_id !== undefined) payload.group_id = change.group_id;
        if (change.stop_order !== undefined)
          payload.stop_order = change.stop_order;

        return { id, payload };
      });

      await Promise.all(
        entries.map(({ id, payload }) => tripsService.updateTrip(id, payload))
      );
```

The migration that documents `stop_order`:

```1:10:supabase/migrations/20260317100000_add_stop_order_to_trips.sql
-- Add stop_order to trips table
-- This column stores the explicit sequence position of a trip within a group.
-- Populated from the dotted group_id CSV format (e.g. "1.1" → stop_order = 1,
-- "1.2" → stop_order = 2). NULL for trips created before this migration or for
-- ungrouped trips. When present, trips in a group are sorted by this value
-- instead of scheduled_at so drivers always see stops in the correct order.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS stop_order INTEGER;

COMMENT ON COLUMN trips.stop_order IS
  'Explicit sequence position of this trip within its group (from dotted group_id CSV format, e.g. "1.2" → 2). NULL means order falls back to scheduled_at.';
```

## 5. Collision Detection

The Fahrten Kanban board does not use a custom collision detection function. It explicitly uses the built-in `pointerWithin` collision detection from `@dnd-kit/core`:

```24:35:src/features/trips/components/kanban/kanban-board.tsx
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin
} from '@dnd-kit/core';
```

```592:597:src/features/trips/components/kanban/kanban-board.tsx
      {/* pointerWithin prefers smaller droppables (trip cards) over columns. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
```

So the default `DndContext` collision behavior is not used, and it is not using `closestCenter`, `closestCorners`, or `rectIntersection`.

There is another DnD context in `src/features/trips/components/trips-overview-widget/trips-overview-widget-board.tsx`, also using `pointerWithin`, but that is the dashboard overview widget board, not the Fahrten page Kanban.

## 6. Column ID Propagation

Each card gets `columnId` as a React prop from its owning column.

`KanbanColumnView` passes `column.id` to single cards:

```163:173:src/features/trips/components/kanban/kanban-column.tsx
          chunkItemsByGroup(items).map((chunk, chunkIdx) =>
            chunk.type === 'single' ? (
              <TripCard
                key={chunk.trips[0].id}
                trip={chunk.trips[0]}
                columnId={column.id}
                groupLabel={undefined}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
```

`KanbanColumnView` also passes `column.id` to grouped containers:

```175:187:src/features/trips/components/kanban/kanban-column.tsx
              <GroupedTripsContainer
                key={chunk.trips[0].group_id ?? chunkIdx}
                trips={chunk.trips}
                groupLabel={
                  chunk.trips[0]?.group_id
                    ? groupLabels[chunk.trips[0].group_id]
                    : undefined
                }
                columnId={column.id}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
```

`GroupedTripsContainer` passes that same `columnId` to each child `TripCard`:

```97:108:src/features/trips/components/kanban/kanban-group-container.tsx
      {/* Individual cards */}
      {trips.map((trip) => (
        <TripCard
          key={trip.id}
          trip={trip}
          columnId={columnId}
          groupLabel={groupLabel}
          hideGroupBadge
          onTimeChange={onTimeChange}
          onStopOrderChange={onStopOrderChange}
          onUngroup={onUngroup}
        />
      ))}
```

`TripCard` stores `columnId` only in the draggable data, not the droppable data:

```113:127:src/features/trips/components/kanban/kanban-trip-card.tsx
  // ── DnD ───────────────────────────────────────────────────────────────────
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `trip-${trip.id}`
  });

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging
  } = useDraggable({
    id: trip.id,
    data: { tripId: trip.id, columnId }
  });
```

Columns store `columnId` in the column header draggable data, but their droppable data is also empty:

```52:65:src/features/trips/components/kanban/kanban-column.tsx
  // ── Droppable (column body accepts trips) ──────────────────────────────────
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  // ── Draggable (header enables column reordering) ───────────────────────────
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging
  } = useDraggable({
    id: `column-${column.id}`,
    data: { columnId: column.id }
  });
```

## Senior Recommendation

The minimal, safest fix is to guard the existing grouping branch in `handleDragEnd`, immediately after `draggedTrip` and `targetTrip` are resolved and before generating `targetGroupId`.

Best insertion point:

```406:410:src/features/trips/components/kanban/kanban-board.tsx
        const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
        const targetTrip = effectiveTrips.find((t) => t.id === targetId);
        if (!draggedTrip || !targetTrip) return;

        const targetGroupId = targetTrip.group_id ?? crypto.randomUUID();
```

The guard should compare the effective board column for both trips under the current `groupBy` mode:

- `driver`: `trip.driver_id ?? 'unassigned'`
- `status`: `trip.status ?? ''`
- `payer`: `trip.payer_id ?? 'no_payer'`

If the derived column IDs differ, the handler should not group. It should continue into the existing assignment branch and treat the drop as a plain column move to the target card's column. This is important because `pointerWithin` returns `trip-{id}` for a card; the existing assignment branch currently assumes `overStr` is already a column id. The same target-column resolution logic used for column reordering should be available for trip assignment too.

This fix does not strictly require changing dnd-kit `data` fields, because `draggedTrip`, `targetTrip`, `effectiveTrips`, and `groupBy` are already available at the decision point. Adding `data: { columnId }` to card droppables would be reasonable later, but it is not necessary for the minimal fix.

Recommended small helper inside `kanban-board.tsx`:

```ts
const getTripColumnId = (trip: KanbanTrip): string =>
  groupBy === 'driver'
    ? (trip.driver_id ?? 'unassigned')
    : groupBy === 'status'
      ? (trip.status ?? '')
      : (trip.payer_id ?? 'no_payer');
```

Then use it for two related decisions:

- In the trip-to-trip branch, allow grouping only when `getTripColumnId(draggedTrip) === getTripColumnId(targetTrip)`.
- If they differ, resolve `targetColumnId` from `targetTrip` and run the plain assignment path against that column instead of using `overStr` as `trip-{id}`.

Edge cases to watch:

- Existing grouped target: dropping onto a card in an existing group should be allowed only if the dragged trip's current column equals the target card's current column. Since `effectiveTrips` includes pending changes, this naturally accounts for unsaved column moves.
- Dragging one card out of an existing group: current code clears `group_id` and `stop_order` when a single grouped card is assigned to a column. Preserve that behavior for cross-column drops.
- Dragging a whole group: currently `isDraggingGroup` skips the grouping branch and moves all group members together. The column guard should not affect group moves.
- Optimistic/local staging: all DnD changes are staged in `pendingChanges` and merged into `effectiveTrips`; use `effectiveTrips`, not raw `trips`, for the guard.
- Save timing: DB writes only happen when clicking `Speichern`. The fix should only change staged `group_id`/assignment decisions, not Supabase write timing.
- Status derivation in driver mode: cross-column plain moves should still call `deriveStatusForPending` through the existing assignment path so assigned/unassigned status badges remain correct.
