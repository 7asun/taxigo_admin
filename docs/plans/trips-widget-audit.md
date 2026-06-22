# Trips Widget Audit

## Scope Notes

The prompt names an older/nonexistent `src/features/admin/...` structure. I could not confirm any of these files in this repo:

- `src/App.tsx`
- `src/features/admin/components/DashboardHeader/DashboardHeader.tsx`
- `src/features/admin/pages/AdminDashboard.tsx`
- `src/features/admin/components/TripsSection/...`
- `src/features/admin/components/TripsViewTabs/...`
- `src/features/admin/components/TripFiltersBar/...`
- `src/features/admin/components/DriverAssignmentDialog/DriverAssignmentDialog.tsx`
- `src/features/admin/hooks/useAdminTrips.ts`
- `src/features/admin/hooks/useTimeBasedTrips.ts`
- `src/features/admin/hooks/useTripFilters.ts`
- `src/features/admin/hooks/useAssignDriver.ts`
- `src/shared/types/trip.types.ts`
- `src/shared/utils/trip.utils.ts`
- `src/lib/constants/routes.ts`
- `src/features/shared/components/RoleBasedDashboard.tsx`

Confirmed equivalents live in the Next.js App Router dashboard layout and `src/features/trips`.

## 1. Header Mount Point

`DashboardHeader` does not exist in this repo. The actual header component is `src/components/layout/header.tsx`, exported as `Header`.

`Header` is rendered in `src/app/dashboard/layout.tsx` inside the authenticated/admin dashboard wrapper:

- `DashboardLayout` performs the Supabase auth/user role check.
- It wraps all `/dashboard/*` routes with `KBar`, `SidebarProvider`, `InfobarProvider`, `AppSidebar`, `SidebarInset`, `Header`, and `InfoSidebar`.
- This means the current header is shared across authenticated admin dashboard pages, not just `/dashboard/overview` or `/dashboard/trips`.

There is no `RoleBasedDashboard` file. Driver pages appear to have their own driver-specific header (`src/features/driver-portal/components/driver-header.tsx`), so this header does not wrap all authenticated pages globally, only the admin dashboard segment.

The header class is:

`bg-background border-border sticky top-0 flex h-16 shrink-0 items-center justify-between gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12`

Confirmed: the header itself does **not** have `z-50`. The `z-50` seen in the codebase belongs to overlays such as `PopoverContent`, `SheetOverlay`, `SheetContent`, and `DialogContent`, not to `Header`.

Right-side header content currently contains:

- `CreateTripDialogButton`: primary button with `Plus` icon and hidden text on small screens.
- `SearchInput`: outline search button with search icon, hidden below `md`.
- `PendingAssignmentsPopover`: outline icon button with `Bell`, badge count, and mobile drawer/desktop popover.

There is room for another icon button without redesign if it stays icon-sized (`h-9 w-9`) and is inserted near `PendingAssignmentsPopover`. On narrow screens the header right area already contains the create-trip button and pending assignments icon, while search is hidden.

## 2. Current "Kanban" - What Actually Exists

There is no `TodayView`, `WeekView`, `MonthView`, `DateNavigation`, `TripsSection`, `TripsViewTabs`, or `timeView` implementation in this repo.

The actual trip page has two views in `src/features/trips/components/trips-view-toggle.tsx`:

- `list`
- `kanban`

The actual Kanban is `TripsKanbanBoard` in `src/features/trips/components/kanban/kanban-board.tsx`.

Confirmed Kanban behavior:

- It renders columns through `KanbanColumnView`.
- Default grouping is by driver: `const [groupBy, setGroupBy] = useState<GroupByMode>('driver')`.
- The board also supports grouping by status and payer via `KanbanHeader`.
- It stages changes in `useKanbanPendingStore` and persists them to localStorage until the user clicks `Speichern`.
- It filters out cancelled trips from visible columns and shows a hidden-cancelled count.
- It also hides Fremdfirma trips from the internal planning board and shows a banner when any were hidden.

Driver grouping exists in the Kanban board:

- `buildColumns(..., groupBy === 'driver', drivers, availabilityMap)` creates one column for `Nicht zugewiesen`, one for every active driver, and orphan driver columns for unknown `driver_id` values.
- `buildItemsByColumn` places trips into `trip.driver_id ?? 'unassigned'`.

Status grouping exists in the same Kanban board:

- Known columns: `pending` -> `Offen`, `assigned` -> `Zugewiesen`, `in_progress` -> `In Fahrt`, `completed` -> `Abgeschlossen`, `cancelled` -> `Storniert`.
- ⚠️ RISK: `scheduled`, `driving`, and `open` are valid statuses in `src/lib/trip-status.ts`, but `buildColumns` does not include them in its known status list. They would become `Status (unbekannt)` columns in status grouping.

Drag-and-drop is implemented with `@dnd-kit`:

- `DndContext`, `DragOverlay`, `MouseSensor`, `TouchSensor`, `pointerWithin` in `kanban-board.tsx`.
- `useDraggable`, `useDroppable`, and `CSS.Translate` in `kanban-column.tsx` and `kanban-trip-card.tsx`.

Drag-drop dependencies in `package.json`:

- `@dnd-kit/core`
- `@dnd-kit/modifiers`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`
- `react-dropzone` is also present, but that is file upload/dropzone, not trip board drag-and-drop.

There is no confirmed non-table, non-map `timeView === 'all'` grid view in this repo. The closest existing grid/list is `UpcomingTrips` in `src/features/overview/components/upcoming-trips.tsx`, which renders a flat date-sorted list of `TripRow` items, not status-grouped columns.

## 3. Data Fetching For The Widget

`useAdminTrips.ts` does not exist.

Confirmed trip data sources:

- Supabase is the data source.
- `tripsService` uses the browser Supabase client in `src/features/trips/api/trips.service.ts`.
- `/dashboard/trips` uses a server Supabase client in `src/features/trips/components/trips-listing.tsx`.

`trips-listing.tsx` server-fetches trips from Supabase `trips`:

- It selects `*` plus payer, billing variant, assignee joins, and invoice line items for Kanban.
- It applies URL filters server-side: status, assignee/driver/fremdfirma, payer, billing variant, KTS, invoice status, search, date range, and sorting.
- For `view === 'kanban'`, it applies `.limit(2000)`.
- For list view, it paginates with `.range(from, to)`.
- It is one-time RSC fetching per render. Realtime refresh is handled separately by `TripsRealtimeSync`, which calls `refreshTripsPage()`.

`useTrips` in `src/features/trips/hooks/use-trips.ts`:

- Uses TanStack Query with `tripKeys.all`.
- Calls `tripsService.getTrips()`.
- `getTrips()` fetches `from('trips').select('*').order('scheduled_at', { ascending: false })`.
- This fetches all trips with no limit or time scope.
- It sets up a Supabase Realtime subscription on all `trips` table changes and invalidates `tripKeys.all`.

`useUpcomingTrips` in `src/features/trips/hooks/use-upcoming-trips.ts`:

- This is the closest existing "today/tomorrow/week upcoming trips" hook.
- It computes Berlin day/week boundaries with `getZonedDayBoundsIso`.
- It calls `tripsService.getUpcomingTrips(startDate, endDate)`.
- `getUpcomingTrips` sends a server-side date range to Supabase: `scheduled_at >= startDate` and `scheduled_at <= endDate`.
- Status filtering is client-side after the date-scoped fetch.
- It sets up Supabase Realtime on all `trips` table changes and refetches the current date window.

There is no `useTimeBasedTrips.ts` and no confirmed `quickStats` object.

There is no `useTodayTrips` hook by that name. Cheapest confirmed way to get "current trip + upcoming trips today" without refetching all trips is to build on the `useUpcomingTrips` pattern or extract a new date-scoped hook that calls `tripsService.getUpcomingTrips(startOfToday, endOfToday)` and filters to `scheduled_at >= now - lead window` client-side. Avoid `useTrips()` for this widget because it fetches all trips.

⚠️ RISK: `useUpcomingTrips` subscribes to all trip changes and refetches the active window on every change. This is acceptable for the overview widget today, but a header-level widget mounted on all admin dashboard pages would make this subscription global.

## 4. Driver Reassignment

`DriverAssignmentDialog.tsx` and `useAssignDriver.ts` do not exist.

Confirmed reassignment implementations:

### `DriverSelectCell`

`src/features/trips/components/trips-tables/driver-select-cell.tsx` updates assignments from the list table:

- Loads active drivers with `useDriversQuery`.
- On select change, computes `newDriverId = value === 'unassigned' ? null : value`.
- Builds the canonical assignment patch with `buildAssignmentPatch(trip, { driver_id: newDriverId })`.
- Writes directly with Supabase client:
  - If `trip.group_id` exists: `from('trips').update(patch).eq('group_id', trip.group_id)`.
  - Else: `from('trips').update(patch).eq('id', trip.id)`.
- Updates local selected state after success.
- Calls `refreshTripsPage()`.

This is not implemented as a reusable mutation hook.

### `TripsKanbanBoard`

Kanban drag/drop only stages reassignment in `useKanbanPendingStore` until `Speichern`.

On save:

- For each pending trip, it builds a payload.
- If `change.driver_id !== undefined`, it calls `buildAssignmentPatch(trip, { driver_id: change.driver_id })`.
- It calls `tripsService.updateTrip(id, payload)` for each trip.
- It invalidates `tripKeys.all`, refreshes the RSC page, and clears pending changes.

### Trip Detail Sheet

`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` has `handleDriverChange`:

- Builds `buildAssignmentPatch(trip, { driver_id: newDriverId })`.
- Calls `tripsService.updateTrip(trip.id, patch)`.
- Invalidates `tripKeys.detail(trip.id)` and `tripKeys.all`.
- Calls `refreshAfterTripSave()`.

### `useUpdateTripMutation`

`src/features/trips/hooks/use-update-trip-mutation.ts` wraps `tripsService.updateTrip`:

- Optimistically merges into `tripKeys.detail(id)` only.
- Invalidates `tripKeys.detail(id)` and `tripKeys.all` on settle.
- It does not optimistically update the list/Kanban RSC payload.

Reassignment requires more than `tripId + driverId` if done correctly:

- The current trip row is needed for `buildAssignmentPatch`, especially `status`, `driver_id`, `fremdfirma_id`, `fremdfirma_payment_mode`, and `fremdfirma_cost`.
- The patch also manages `needs_driver_assignment` and clears Fremdfirma fields when an internal driver is assigned.
- For grouped table rows, `group_id` changes whether the update is applied to one trip or the whole group.

⚠️ RISK: Assignment write behavior is duplicated across table, Kanban, detail sheet, and dispatch inbox. A header widget should extract or reuse a small assignment mutation helper instead of copying another variant.

## 5. Trip Data Model

The canonical trip type is:

- `Trip = Database['public']['Tables']['trips']['Row']` in `src/features/trips/api/trips.service.ts`.

Relevant confirmed `trips` row fields from `src/types/database.types.ts`:

- `id: string`
- `status: string`
- `scheduled_at: string | null`
- `requested_date: string | null`
- `driver_id: string | null`
- `fremdfirma_id: string | null`
- `fremdfirma_payment_mode: string | null`
- `fremdfirma_cost: number | null`
- `needs_driver_assignment: boolean`
- `client_name: string | null`
- `client_phone: string | null`
- `pickup_address: string | null`
- `dropoff_address: string | null`
- `pickup_station: string | null`
- `dropoff_station: string | null`
- `payer_id: string | null`
- `billing_type_id: string | null`
- `billing_variant_id: string | null`
- `group_id: string | null`
- `stop_order: number | null`
- `is_wheelchair: boolean`
- `link_type: string | null`
- `linked_trip_id: string | null`
- `actual_pickup_at: string | null`
- `actual_dropoff_at: string | null`

There is no `pickupDateTime` field and no `patientName` field. UI code uses `scheduled_at` for trip time and `client_name` plus `greeting_style`/passenger helpers for passenger display.

Confirmed `TripStatus` union in `src/lib/trip-status.ts`:

- `completed`
- `assigned`
- `scheduled`
- `in_progress`
- `driving`
- `cancelled`
- `pending`
- `open`

Confirmed labels:

- `completed` -> `Erledigt`
- `assigned` -> `Zugewiesen`
- `scheduled` -> `Geplant`
- `in_progress` -> `Unterwegs`
- `driving` -> `Unterwegs`
- `cancelled` -> `Storniert`
- `pending` -> `Offen`
- `open` -> `Offen`

Confirmed current Kanban status columns:

- `pending` -> `Offen`
- `assigned` -> `Zugewiesen`
- `in_progress` -> `In Fahrt`
- `completed` -> `Abgeschlossen`
- `cancelled` -> `Storniert`

There is a concept close to "last trip" in `src/features/trips/lib/trip-list-scroll-anchor.ts`:

- `getTripListScrollAnchorId` anchors to the last trip at or before `now - 15 minutes`.
- If none exists, it uses the first trip after that time.
- This is used by `UpcomingTrips` to scroll the list near the current time.

There is no confirmed persisted or named "last completed trip today" concept.

## 6. Widget Mount Feasibility

Best insertion point: `src/components/layout/header.tsx`, inside the right-side container:

`<div className='flex shrink-0 items-center gap-2 px-4'>`

Recommended placement is immediately before `PendingAssignmentsPopover`, because:

- It keeps operational trip-status icons together.
- `PendingAssignmentsPopover` is already a header icon button using Popover/Drawer.
- It avoids mixing the widget into page-level actions such as `/dashboard/trips` header actions.

Alternative placement is after `CreateTripDialogButton` and before search, but on desktop this separates it from the existing dispatch bell.

Existing shadcn/Radix overlay components are already present:

- `src/components/ui/popover.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/drawer.tsx` is used by `PendingAssignmentsPopover` on narrow screens.
- `src/components/ui/alert-dialog.tsx` also exists and is used in multiple features.

Confirmed overlay usage:

- `PendingAssignmentsPopover` already uses desktop `Popover` and mobile `Drawer`.
- `CreateTripDialogButton` opens `CreateTripDialog`.
- `TripDetailSheet` uses a sheet-style detail flow.
- `AnsichtenSheet`, payer details, driver form, recurring rules, and driver portal header use sheets.

Global trip state:

- TanStack Query `tripKeys.all` exists through `useTrips`, but it fetches all trips and is primarily used for dashboard stats.
- `/dashboard/trips` list/Kanban data is not globally stored in Query; it is RSC props from `trips-listing.tsx`.
- `TripsRscRefreshProvider` exists only under `/dashboard/trips` via `FahrtenPageShell`.
- `useKanbanPendingStore` is Zustand, but it only tracks unsaved Kanban pending changes, not trip data.

⚠️ BLOCKER: A header-level widget mounted on every admin dashboard page cannot rely on `useTripsRscRefresh()` because `TripsRscRefreshProvider` is only mounted inside `/dashboard/trips`.

⚠️ RISK: Reusing `useTrips()` in the header would subscribe globally and fetch all trips on every dashboard page. A date-scoped query hook is safer.

## 7. File Structure Recommendation

Follow the existing feature component folder pattern, but place the widget under `src/features/trips/components` because the current repo does not use `src/features/admin`.

Recommended tree:

```text
src/features/trips/components/header-trips-widget/
  index.ts
  header-trips-widget-button.tsx
  header-trips-widget-popover.tsx
  header-trips-widget-drawer.tsx
  header-trips-widget-board.tsx
  header-trips-widget-column.tsx
  header-trips-widget-card.tsx
  header-trips-widget-date-nav.tsx
  header-trips-widget-driver-select.tsx

src/features/trips/hooks/
  use-header-trips-widget.ts
  use-trip-assignment-mutation.ts

src/features/trips/lib/
  header-trips-widget-columns.ts
  header-trips-widget-filter.ts
```

Suggested responsibilities:

- `header-trips-widget-button.tsx`: icon button, count badge, loading/error indicator.
- `header-trips-widget-popover.tsx`: desktop popover shell.
- `header-trips-widget-drawer.tsx`: mobile drawer shell, matching `PendingAssignmentsPopover`.
- `header-trips-widget-board.tsx`: lightweight board layout for current/upcoming trips.
- `header-trips-widget-column.tsx`: status/time columns without full page Kanban chrome.
- `header-trips-widget-card.tsx`: compact trip card with passenger, time, pickup/dropoff, status, driver.
- `header-trips-widget-date-nav.tsx`: date picker / today navigation.
- `header-trips-widget-driver-select.tsx`: assignment UI using shared assignment mutation.
- `use-header-trips-widget.ts`: date-scoped Supabase/TanStack query for selected day and current/upcoming filtering.
- `use-trip-assignment-mutation.ts`: shared mutation wrapper around `buildAssignmentPatch` + `tripsService.updateTrip`.
- `header-trips-widget-columns.ts`: status bucket definitions for widget columns.
- `header-trips-widget-filter.ts`: current/upcoming selection and "last/current trip" anchor helpers.

## Senior Recommendation

Do **not** extract and reuse the existing full `TripsKanbanBoard` inside the header widget.

Reasoning:

- `TripsKanbanBoard` is a page-level planning surface. It assumes a large scrollable area, zoom controls, column reordering, DnD grouping, pending localStorage state, `TripsRscRefreshProvider`, driver availability, and RSC refresh semantics.
- A header widget needs a compact, always-mounted, date-scoped overview. Pulling the full board into a Popover/Sheet would bring too much state, layout, and refresh coupling.
- Reusing the full board would also risk conflicts with its localStorage pending-change behavior and large 2000-row Kanban fetch assumptions.

Recommended approach: build a new lightweight header widget using existing primitives and utilities:

- Reuse visual ideas and small pure helpers from Kanban where appropriate (`TripCard` layout ideas, `buildAssignmentPatch`, `tripStatusLabels`, `tripStatusBadge`, `getTripListScrollAnchorId`).
- Reuse the `PendingAssignmentsPopover` responsive shell pattern: desktop `Popover`, mobile `Drawer` or `Sheet`.
- Add a date-scoped hook modeled after `useUpcomingTrips`, not `useTrips`.
- Extract a shared assignment mutation around `buildAssignmentPatch` so the widget does not duplicate table/detail/Kanban write logic.

Best option: **(c) build a purpose-built compact widget using existing hooks/utilities as source material, and extract one shared assignment mutation before wiring reassignment.**
