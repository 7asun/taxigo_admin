# Question 1 — DnD Isolation: Can The Widget Use @dnd-kit Independently Of useKanbanPendingStore?

> **IMPLEMENTED** — see [docs/features/trips-overview-widget.md](../features/trips-overview-widget.md)

Confirmed file list for `src/features/trips/components/kanban/`:

- `kanban-board.tsx`
- `kanban-column.tsx`
- `kanban-driver-column-header.tsx`
- `kanban-drag-preview.tsx`
- `kanban-group-container.tsx`
- `kanban-header.tsx`
- `kanban-trip-card.tsx`
- `index.ts`

`useKanbanPendingStore` is not in `src/features/trips/hooks/`. It is defined at `src/features/trips/stores/use-kanban-pending-store.ts`.

`useKanbanPendingStore` is wired in the top-level board component, not inside `DndContext` itself and not inside the visual sub-components. In `kanban-board.tsx`, `TripsKanbanBoard` imports:

- `useKanbanPendingStore`
- `syncTripIds`

Then it reads:

- `pendingChanges`
- `setPendingChanges`
- `clearPendingChanges`
- `pruneToIds`

`DndContext` receives local handlers created inside `TripsKanbanBoard`:

- `onDragStart={handleDragStart}`
- `onDragEnd={handleDragEnd}`

`handleDragEnd` is not passed in as a prop. It is defined inside `kanban-board.tsx` and directly calls `setPendingChanges` for trip/group assignment changes. It also calls `setColumnOrderByMode` for column reordering. So the full board cannot be configured from outside to use a different `onDragEnd`; replacing the save behavior means writing a different parent board/orchestrator.

What `handleDragEnd` does:

- Clears `activeDragId`.
- If there is no `over`, returns.
- If dragging a column header (`column-{id}`), it resolves the target column and updates `columnOrderByMode`.
- If dragging a trip onto another trip, it stages grouping by writing `group_id` and `stop_order` into `setPendingChanges`.
- If dragging a trip or group onto a column, it computes the target value from `groupBy`:
  - `driver`: target column id or `null` for `unassigned`
  - `status`: target status id
  - `payer`: payer id or `null` for `no_payer`
- It stages assignment/status/payer changes through `setPendingChanges`.
- For driver grouping, it stages `driver_id` and derived status with `deriveStatusForPending`.
- It does not call `tripsService.updateTrip` on drop. Actual Supabase writes happen later in `handleSave`.

Sub-component store imports:

- `kanban-board.tsx`: yes, imports `useKanbanPendingStore` and `syncTripIds`.
- `kanban-column.tsx`: no.
- `kanban-trip-card.tsx`: no.
- `kanban-group-container.tsx`: no.
- `kanban-drag-preview.tsx`: no.
- `kanban-header.tsx`: no.
- `kanban-driver-column-header.tsx`: no.
- `index.ts`: no direct store import; it only exports `TripsKanbanBoard`.

Confirmed: the widget can use `@dnd-kit` independently of `useKanbanPendingStore` by creating its own parent board with its own `DndContext` and `onDragEnd` handler that calls `tripsService.updateTrip` immediately.

Confirmed: `KanbanColumnView`, `TripCard`, `GroupedTripsContainer`, `KanbanDriverColumnHeader`, and `KanbanDragPreview` do not import `useKanbanPendingStore`. They receive callbacks/props from the parent. They can be reused without importing the store, as long as the widget supplies the required callbacks (`onTimeChange`, `onStopOrderChange`, `onUngroup`) or wraps/adapts them.

Confirmed constraint: the existing exported `TripsKanbanBoard` cannot be reused for immediate-save DnD without modification because its local `handleDragEnd` is hard-wired to `setPendingChanges` and its `handleSave` is the only place that writes pending DnD changes to Supabase.

# Question 2 — Date Picker: What UI Components Already Exist For Date Selection?

Confirmed missing files:

- `src/components/ui/date-picker.tsx` does not exist.
- `src/components/ui/date-range-picker.tsx` does not exist.
- No `DateNavigation`-style component was found under `src/features/trips/components/`.

Confirmed reusable date UI components:

- `src/components/ui/calendar.tsx`: shadcn-style `Calendar` wrapper around `react-day-picker` `DayPicker`; supports single/range modes through DayPicker props and custom class names.
- `src/components/ui/date-time-picker.tsx`: exports `DateTimePicker`, `DatePicker`, `DateRangePicker`, `dateRangePickerDefaultPresets`, and shared calendar class names.
- `src/components/ui/date-time-picker.tsx` / `DateTimePicker`: renders a date button + time input on desktop, and uses `MobileDateTimeSheet` for narrow screens.
- `src/components/ui/date-time-picker.tsx` / `DatePicker`: renders a date-only picker for `yyyy-MM-dd` string values using `Popover` + `Calendar` on desktop and `MobileDateTimeSheet` on narrow screens.
- `src/components/ui/date-time-picker.tsx` / `DateRangePicker`: renders a range picker with preset shortcuts (`Heute`, `Diese Woche`, `Letzte Woche`, `Nächste Woche`, `Dieser Monat`, `Letzter Monat`) and a `Calendar` in range mode.
- `src/components/ui/table/data-table-date-filter.tsx`: table filter button that opens a `Popover` with `Calendar` in single or range mode and writes timestamps to a TanStack Table column filter.
- `src/components/forms/form-date-picker.tsx`: React Hook Form date picker using `Popover` + `Calendar`.
- `src/components/forms/form-birthdate-picker.tsx`: React Hook Form birthdate field with text input plus `Popover` + `Calendar`, German parsing, and dropdown year selection.
- `src/features/trips/components/create-trip/mobile-datetime-sheet.tsx`: mobile bottom-sheet style date/time wheel picker using `react-mobile-picker` inside `Dialog`.
- `src/features/trips/components/trips-filters-bar.tsx`: uses `DateRangePicker` from `src/components/ui/date-time-picker.tsx` for the Fahrten `scheduled_at` URL filter.
- `src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx`: confirmed by search to use `DatePicker` from `src/components/ui/date-time-picker.tsx` for `Neues Datum`.
- `src/features/overview/components/upcoming-trips.tsx`: has a simple `Select` for `Heute`, `Morgen`, `Woche`; it is not a calendar/date picker.

Confirmed date libraries in `package.json`:

- `react-day-picker`: present (`^8.10.1`).
- `date-fns`: present (`^4.1.0`).
- `@date-fns/tz`: present (`^1.4.1`).
- `@internationalized/date`: not present.
- `dayjs`: not present.
- `react-datepicker`: not present.

Confirmed: `react-day-picker` and the shadcn-style `Calendar` component are present. The existing date nav can be built on `Calendar` and/or the existing `DatePicker` from `src/components/ui/date-time-picker.tsx`.

# Question 3 — Fremdfirma Visual Indicator: How Are Fremdfirma Trips Currently Marked In The UI?

Confirmed file list for `src/features/trips/components/trips-tables/`:

- `cell-action.tsx`
- `columns.tsx`
- `driver-select-cell.tsx`
- `duplicate-trips-dialog.tsx`
- `index.tsx`
- `inline-cells/assignment-conflict-indicator.tsx`
- `inline-cells/index.ts`
- `inline-cells/kts-cells.tsx`
- `inline-cells/reha-cells.tsx`
- `trips-mobile-card-list.tsx`
- `trips-pagination-bulk-actions.tsx`

`kanban-trip-card.tsx` does not render a Fremdfirma indicator. The full Kanban filters Fremdfirma trips out before rendering cards:

- `kanban-board.tsx` computes `hiddenFremdfirmaCount`.
- `visibleTrips` excludes `isTripFremdfirma(trip)`.
- If hidden Fremdfirma trips exist, the board shows a banner: `{hiddenFremdfirmaCount} Fremdfirma-Fahrten sind ausgeblendet · Zu Fahrten`.

`src/features/overview/components/trip-row.tsx` does not render a Fremdfirma badge/icon/label. It renders the driver text as `Fahrer: {trip.driver?.name || '---'}`.

Confirmed table/list Fremdfirma rendering:

- `src/features/trips/components/trips-tables/columns.tsx`, column `fremdfirma`: renders the joined `row.original.fremdfirma.name` as centered text, or `—` if missing. Header label is `Fremdfirma`.
- `src/features/trips/components/trips-tables/columns.tsx`, column `fremdfirma_abrechnung`: if `row.original.fremdfirma_id` exists, renders a secondary `Badge` with `fremdfirmaPaymentModeLabel(row.original.fremdfirma_payment_mode)`. Header label is `Abrechnung Fremdfirma`.
- `src/features/trips/components/trips-tables/driver-select-cell.tsx`: if `resolveTripAssignee(trip)` returns `kind === 'fremdfirma'`, renders `TripAssigneeBadge` instead of a driver select.
- `src/features/trips/components/trips-mobile-card-list.tsx`: calls `resolveTripAssignee(trip)` and renders `TripAssigneeBadge` under the time/date block.
- `src/features/trips/components/trip-assignee-badge.tsx`: shared display component. For Fremdfirma assignees it renders `Extern · {assignee.label}` as text and uses the title `Abrechnungsart siehe Spalte „Abrechnung Fremdfirma“`.

Confirmed helper:

- `src/features/trips/lib/trip-assignee.ts` has `resolveTripAssignee`. It treats `fremdfirma_id` as taking precedence over `driver_id`.
- If no joined name exists, the fallback label is `Fremdfirma`.

Confirmed German labels/wording:

- Shared assignee label pattern: `Extern · {name}`.
- Fallback assignee label: `Fremdfirma`.
- Table column label: `Fremdfirma`.
- Table payment column label: `Abrechnung Fremdfirma`.
- Kanban hidden banner: `Fremdfirma-Fahrten sind ausgeblendet`.
- Filter label found in `trips-filters-bar.tsx`: `Alle Fremdfirmen`.

There is no separate component named `FremdfirmaIndicator`. The reusable component is `TripAssigneeBadge`, which handles Fremdfirma as one variant of a resolved assignee. The table Fremdfirma name/payment columns are inlined in `columns.tsx`.

# Question 4 — useUpcomingTrips Realtime Behavior: Subscription Deduplication And Channel Count

`src/features/trips/hooks/use-upcoming-trips.ts`:

- Does not use TanStack Query.
- Has no query key.
- Holds local React state: `trips`, `filter`, `statusFilter`, `isLoading`, `error`.
- Calls `tripsService.getUpcomingTrips(startDate, endDate)` directly.
- Calls `supabase.channel(...)` directly.
- Does not go through a shared realtime utility.
- Channel name is dynamic by filter: ``schema-db-changes-${filter}``.
- Confirmed possible channel names from the hook's filter type: `schema-db-changes-today`, `schema-db-changes-tomorrow`, `schema-db-changes-week`.
- The subscription listens to `event: '*'` on `public.trips`.
- On every event, it calls `fetchUpcomingTrips()` directly.

`src/features/trips/hooks/use-trips.ts` / `useTrips`:

- Uses TanStack Query with exact query key `tripKeys.all`, which is `['trips']`.
- Calls `supabase.channel(...)` directly inside the hook.
- It does use a shared debounce utility: `createDebouncedInvalidateByQueryKey`.
- Channel name is static: `trips-all-changes`.
- The subscription listens to `event: '*'` on `public.trips`.
- On every event, it debounces invalidation of `tripKeys.all`.

`src/features/trips/hooks/use-trips.ts` / `useTripQuery(id)`:

- Uses TanStack Query with `tripKeys.detail(id)`, which is `['trips', 'detail', id]`.
- Calls `supabase.channel(...)` directly inside the hook.
- It uses `createDebouncedTripDetailInvalidation`.
- Channel name is dynamic per trip id: ``trip-${id}-changes``.
- The subscription listens to `event: 'UPDATE'` on `public.trips` with filter `id=eq.${id}`.

`src/features/trips/components/trips-realtime-sync.tsx`:

- Used on `/dashboard/trips`.
- Calls `supabase.channel(...)` directly.
- It uses shared debounce utility `createDebouncedCallback`.
- Channel name is static: `trips-realtime-sync`.
- It listens to `INSERT` and `UPDATE` on `public.trips`.
- It calls `refreshTripsPage()` to refresh the RSC list/Kanban payload and invalidate trip caches.

Multiple mounts:

- Multiple mounted `useUpcomingTrips()` instances would each create their own Supabase channel. There is no shared singleton and no TanStack Query deduplication because this hook does not use Query.
- Multiple mounted `useTrips()` instances would share/deduplicate the fetch through TanStack Query key `['trips']`, but each hook instance still creates its own Supabase channel in `useEffect`.
- If the header widget mounts a `useUpcomingTrips`-style hook on every admin dashboard page and the user navigates to `/dashboard/trips`, confirmed simultaneous trip realtime channels would be:
  - one widget channel, e.g. `schema-db-changes-today`;
  - one trips page RSC refresh channel, `trips-realtime-sync`.
- These channel names are different, so they should not conflict by name. They also do not deduplicate. Both would receive relevant `trips` events and trigger their own refresh/fetch path.

Confirmed risk for the widget use case:

- Mounting a `useUpcomingTrips`-style subscription globally in the header means at least one extra realtime channel is open on every admin dashboard page.
- On `/dashboard/trips`, that becomes at least two trip realtime channels.
- If another component on the same page also mounts `useUpcomingTrips` with the same filter, another independent `schema-db-changes-${filter}` channel and another local fetch path would be created.
- TanStack Query cannot deduplicate `useUpcomingTrips` fetches because there is no query key in that hook.
