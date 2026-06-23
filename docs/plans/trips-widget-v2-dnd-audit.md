# Trips Overview Widget — v2 DnD Pre-Flight Audit

Read-only audit of the full Kanban DnD implementation and current widget stubs, to inform v2 drag-and-drop reassignment in `TripsOverviewWidget`.

---

## Question 1 — Sensors and activation constraints

### Sensors passed to `DndContext` in `kanban-board.tsx`

`kanban-board.tsx` builds sensors with `useSensors` / `useSensor` from **`@dnd-kit/core`** (lines 196–201):

| Sensor | Import path | Activation constraint |
|--------|-------------|---------------------|
| **MouseSensor** | `@dnd-kit/core` | `{ distance: 5 }` |
| **TouchSensor** | `@dnd-kit/core` | `{ delay: 120, tolerance: 8 }` |

**Not used in the Kanban board:**

- **PointerSensor** — not imported or used
- **KeyboardSensor** — not imported or used

### `@dnd-kit/modifiers`

**Not imported anywhere under `src/features/trips/components/kanban/`.**

Elsewhere in the codebase:

| Location | Modifier | Usage |
|----------|----------|--------|
| `src/components/ui/table/data-table.tsx` | `restrictToHorizontalAxis` from `@dnd-kit/modifiers` | Passed to a `DndContext` `modifiers` prop for column reorder |

No Kanban file uses `@dnd-kit/modifiers`.

### `@dnd-kit/*` packages in `package.json`

| Package | Version |
|---------|---------|
| `@dnd-kit/core` | `^6.3.1` |
| `@dnd-kit/modifiers` | `^9.0.0` |
| `@dnd-kit/sortable` | `^10.0.0` |
| `@dnd-kit/utilities` | `^3.2.2` |

(`@dnd-kit/utilities` is used by Kanban cards for `CSS.Translate.toString(transform)`; not configured at the sensor layer.)

### `kanban-trip-card.tsx` — per-draggable constraints

`useDraggable` is called with **no `activationConstraint`**:

```typescript
useDraggable({
  id: trip.id,
  data: { tripId: trip.id, columnId }
});
```

Activation is entirely governed by the parent `DndContext` sensors. The card spreads `{...listeners, ...attributes}` onto the `Card` element (unless `disableDrag`).

Time/stop-order/ungroup controls call `onPointerDown={(e) => e.stopPropagation()}` so those sub-controls do not start a drag.

### Copy-ready sensor config for the widget

```typescript
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin
} from '@dnd-kit/core';

const sensors = useSensors(
  useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  useSensor(TouchSensor, {
    activationConstraint: { delay: 120, tolerance: 8 }
  })
);
```

Use **identical** sensor values as the full Kanban unless modal-scroll testing proves otherwise.

### Widget vs full Kanban — sensor recommendation

**Default: use identical sensors.**

**⚠️ MODAL SCROLL RISK:** The widget board scroll container is `overflow-x-auto overflow-y-auto` inside a Radix `Dialog` (`trips-overview-widget-board.tsx`). The full Kanban scroll owner is a single `overflow-auto` wrapper around `DndContext` on the Fahrten page — not a modal with horizontal column scroll.

Touch drags inside nested scroll regions can compete with native scroll (especially horizontal column panning). The Kanban’s `TouchSensor` `{ delay: 120, tolerance: 8 }` acts as a short long-press before drag starts, which partially mitigates accidental scroll, but **120 ms may be insufficient** when the user is trying to scroll the board horizontally.

If QA shows scroll-vs-drag conflicts in the widget:

1. Increase touch `delay` (e.g. 200–250 ms) before changing distance on mouse.
2. Consider `touch-action: none` on draggable card handles only (not on the scroll container).
3. Do **not** add `@dnd-kit/modifiers` unless a specific axis-lock is required — the full Kanban does not use them for trip drag.

### Current widget state (`trips-overview-widget-board.tsx`)

- `<DndContext sensors={[]}>` — inert; no activation
- v2 stub comment at board root (lines 32–34)
- `TripCard` rendered with `disableDrag` in `trips-overview-widget-column.tsx` (v2 stub comment line 34)

---

## Question 2 — DragOverlay and KanbanDragPreview

### `KanbanDragPreview` signature

From `kanban-drag-preview.tsx`:

```typescript
interface KanbanDragPreviewProps {
  activeId: string;
  effectiveTrips: KanbanTrip[];
  groupLabels: Record<string, string>;
}
```

- **`activeId`**: string — either a trip UUID (`trip.id`) or `group-{groupId}` for grouped drags
- **`effectiveTrips`**: full trip array used to resolve the dragged trip(s)
- **`groupLabels`**: `Record<string, string>` — e.g. `"Gruppe 1"`

No optional props. No dnd-kit hooks inside the component.

### Preview content — full `TripCard` or simplified?

**Simplified preview.** `KanbanDragPreview` does **not** import `kanban-trip-card.tsx`.

It renders:

- **Single trip:** a compact `Card` with time, passenger label, truncated pickup/dropoff lines, optional payer badge, billing-color left border
- **Group:** a bordered container showing group label + up to 2 mini trip rows + “+N weitere”

Uses `@/components/ui/card`, `@/components/ui/badge`, and shared display helpers (`resolvePassengerLabel`, `formatKanbanTripAddressLine`).

### Usage in `kanban-board.tsx` — exact JSX and active-item resolution

**Active item resolution:**

1. `handleDragStart` sets `activeDragId` from `String(event.active.id)` (line 336)
2. `handleDragEnd` clears `activeDragId` to `null` (line 348)
3. `DragOverlay` renders when `activeDragId` is truthy — **not** by reading `active.data.current` in the overlay

**Render tree** (inside `boardArea`, lines 583–631):

```tsx
<div className='min-h-0 min-w-0 flex-1 overflow-auto'>
  <DndContext
    sensors={sensors}
    collisionDetection={pointerWithin}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    <div className='inline-flex min-h-[260px] min-w-max gap-3 p-3' style={{ zoom }}>
      {/* KanbanColumnView × N */}
    </div>

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

**`DragOverlay` props in full Kanban:**

- `dropAnimation={null}` only
- **No `zIndex` prop**
- **No `modifiers` prop**

(Full Kanban applies `style={{ zoom }}` on an inner wrapper so the preview matches board zoom — widget has no zoom control; omit that wrapper.)

### DragOverlay vs scroll container

**Inside `DndContext`, sibling to the columns row, outside the inline-flex columns wrapper.**

The scroll owner in Kanban is the **parent** `<div className='… overflow-auto'>` wrapping the entire `DndContext`. `DragOverlay` is a direct child of `DndContext`, not inside the `inline-flex` columns div.

`DragOverlay` renders via portal (dnd-kit default), so it is not clipped by the scroll container’s overflow.

### Wiring guide for `trips-overview-widget-board.tsx`

Target structure (mirror Kanban sibling order):

```tsx
<div className='flex min-h-0 flex-1 flex-col'>
  <DndContext
    sensors={sensors}
    collisionDetection={pointerWithin}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    {/* Scroll container — columns only */}
    <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
      <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
        {/* TripsOverviewWidgetColumn × N */}
      </div>
    </div>

    {/* Sibling to scroll div, still inside DndContext */}
    <DragOverlay dropAnimation={null}>
      {activeDragId ? (
        <KanbanDragPreview
          activeId={activeDragId}
          effectiveTrips={trips}
          groupLabels={groupLabels}
        />
      ) : null}
    </DragOverlay>
  </DndContext>
</div>
```

**Implementation notes for widget v2:**

1. Add `activeDragId` state + `handleDragStart` / `handleDragEnd` (widget `onDragEnd` calls `useWidgetTripAssignment().assignDriver` — stub already documented in board/column comments and hook file).
2. Remove `disableDrag` from `TripCard` in the widget column (or pass `disableDrag={false}` for non-Fremdfirma trips only).
3. Reuse `KanbanDragPreview` as-is for single-trip drags; widget v1 does not use `GroupedTripsContainer` — group drag preview path exists in `KanbanDragPreview` but widget currently renders grouped trips as individual cards. Decide in v2 plan whether group drag is in scope.
4. Use `collisionDetection={pointerWithin}` like Kanban (column bodies use `useDroppable({ id: column.id })` — widget columns need `useDroppable` on column root or body for drop targets; currently **no droppable** on widget columns).
5. No zoom wrapper around `KanbanDragPreview` in the widget.

---

## Question 3 — Mobile and touch patterns on existing cards

### Touch-specific interaction on `kanban-trip-card.tsx`

**No dedicated touch handlers** (`onTouchStart`, long-press library, context menu, swipe).

Existing pointer interactions:

- `onClick={(e) => e.stopPropagation()}` on time chip shell, ungroup button, stop-order wrapper — prevents drag/click bubbling from those controls
- `{...listeners, ...attributes}` on the `Card` for drag (when `disableDrag` is false)
- `cursor-grab` / `active:cursor-grabbing` classes

**No card-level tap action** — clicking the card body does not open detail, select, or show a menu.

### Long-press-to-drag via `TouchSensor`

**Yes, implicitly.** Full Kanban configures:

```typescript
useSensor(TouchSensor, {
  activationConstraint: { delay: 120, tolerance: 8 }
});
```

Touch drag requires **120 ms hold** with up to **8 px** movement tolerance before drag activates. This is the Kanban’s mobile drag pattern — not a separate long-press handler on the card.

### Trip cards elsewhere — tap / overflow / reassignment

| File | Path status | Tap / click | Overflow / reassignment |
|------|-------------|-------------|-------------------------|
| `trips-mobile-card-list.tsx` | **Does not exist** at `src/features/overview/components/trips-mobile-card-list.tsx`. Actual path: `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | Card is not row-clickable for detail; uses **`CellAction`** (`…` / `MoreHorizontal` dropdown) per card | Dropdown: Ansehen, Bearbeiten, Verschieben, Teilen, Storno, Löschen — **no direct “Fahrer zuweisen” menu item**; driver assignment is in **`TripDetailSheet`** (Select on `driver_id`) |
| `trip-row.tsx` | Exists at `src/features/overview/components/trip-row.tsx` | **`onClick` prop** — parent opens detail (`upcoming-trips.tsx` → `TripDetailSheet`) | Share button (`Share2`) stops propagation; displays driver name read-only; **no reassignment in row** |

### Existing Sheet / Drawer for mobile trip actions

Confirmed in `src/components/ui/`:

- `drawer.tsx` — Vaul-based Drawer
- `sheet.tsx` — Radix Sheet

**Trip-related usage:**

| Component | Pattern |
|-----------|---------|
| `TripDetailSheet` (`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`) | **`Sheet`** — tap/“Ansehen” opens side sheet with driver `Select`, save, storno, etc. |
| `PendingAssignmentsPopover` | **`Drawer`** on narrow viewports (`useIsNarrowScreen(768)`), Popover on md+ |
| `CreateTripDialog` | **`Drawer`** below 768px, **`Dialog`** from md up |
| `CellAction` | Opens **`TripDetailSheet`** via “Ansehen” menu item |

No existing Drawer/Sheet is dedicated to “pick a driver for this Kanban card” without opening full trip detail.

### `kanban-trip-card.tsx` — current click behavior

**Nothing on card tap** except initiating drag (via dnd-kit listeners). Sub-controls (time input, ungroup, stop-order) stop propagation. **No navigation, no detail sheet, no context menu.**

### Mobile fallback recommendation for widget v2

**Do not rely on drag alone for mobile in the modal widget.**

**Recommended pattern: extend existing Sheet + driver Select pattern, not invent a new menu.**

1. **Desktop / pointer:** DnD with identical `MouseSensor` / `TouchSensor` config + `KanbanDragPreview` + column `useDroppable` + `useWidgetTripAssignment` on drop (as planned).

2. **Mobile / narrow (fallback when DnD is unreliable in modal scroll):**
   - Detect narrow viewport with existing **`useIsNarrowScreen(768)`** (same breakpoint as `PendingAssignmentsPopover`, `CreateTripDialog`, trips mobile card list).
   - On **tap** of a non-Fremdfirma `TripCard` in the widget (add an explicit `onClick` — Kanban card has none today), open a **bottom `Drawer`** (reuse `src/components/ui/drawer.tsx`) with:
     - Trip summary (passenger + time — already on card)
     - Driver **`Select`** mirroring `DriverSelectCell` / `TripDetailSheet` driver field
     - On confirm → `useWidgetTripAssignment().assignDriver({ trip, newDriverId })`
   - Keep **Fremdfirma trips read-only** (no drawer).

3. **Reusable components:**
   - `useWidgetTripAssignment` — already the v2 mutation primitive
   - `useDriversQuery()` — already used in dialog
   - `Drawer` / `DrawerContent` from `@/components/ui/drawer`
   - Driver select UI can copy the compact `Select` block from `DriverSelectCell` or `trips-overview-widget`’s removed inline select pattern (without `useTripsRscRefresh`)

4. **Do not reuse `TripDetailSheet` wholesale** for widget reassignment — it is a full edit surface with RSC refresh coupling; scope is too large for a dispatch quick-assign flow.

5. **Touch drag optional enhancement:** Keep Kanban `TouchSensor` `{ delay: 120, tolerance: 8 }` for users who long-press; if modal scroll conflicts persist, the Drawer tap path is the primary mobile UX and drag remains secondary.

---

## Widget v2 insertion points (confirmed)

| Location | File | Current state |
|----------|------|---------------|
| Board root | `trips-overview-widget-board.tsx` | `<DndContext sensors={[]}>` + v2 comment; needs sensors, handlers, `DragOverlay`, column droppables |
| Column | `trips-overview-widget-column.tsx` | `TripCard disableDrag`; v2 comment references `useWidgetTripAssignment` + `onDragEnd` |
| Mutation | `use-widget-trip-assignment.ts` | Ready `assignDriver` mutation; v2 comment for `onDragEnd` |

Trigger (`trips-overview-widget-trigger.tsx`) has no DnD involvement — icon opens dialog only.

---

## Confirmation — groupLabels empty object safety

**Does `KanbanDragPreview` read `groupLabels` for a plain trip UUID?**  
No. The component sets `const isGroup = activeId.startsWith('group-')` (line 28) and branches immediately: the entire group-preview block (`if (isGroup) { … }`, lines 31–63) is the **only** place `groupLabels` is referenced (`groupLabels[groupId] ?? 'Gruppe'` on line 39). For a plain trip UUID, `isGroup` is false, that block is skipped entirely, and execution falls through to the single-trip preview (lines 65–112), which uses only `activeId`, `effectiveTrips`, and fields on the resolved `trip` — **`groupLabels` is never read**.

**Can `groupLabels={{}}` cause a runtime error or broken render for a plain UUID drag?**  
No. The single-trip path never indexes `groupLabels`. The only early exits on that path are: `effectiveTrips.find((t) => t.id === activeId)` returns `undefined` → `return null` (line 67), which renders nothing but does not throw. An empty `groupLabels` object is inert for non-group drags. (If `activeId` were mistakenly prefixed with `group-`, the group branch would still be safe: `groupLabels[groupId] ?? 'Gruppe'` falls back to the literal `'Gruppe'`.)

**What selects group preview vs single-trip preview?**  
**`activeId.startsWith('group-')`** — that boolean alone chooses the branch. It is not a lookup in `effectiveTrips` or `groupLabels`. Within the group branch, `groupId` is derived via `activeId.replace('group-', '')` and trips are filtered by `t.group_id === groupId`; within the single branch, the trip is resolved with `effectiveTrips.find((t) => t.id === activeId)`. No other condition gates the top-level split.
