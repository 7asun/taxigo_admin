# Fahrten page (`/dashboard/trips`): RSC refresh vs TanStack Query

## Mental model

| Layer | What it powers | How it updates |
|--------|----------------|----------------|
| **RSC** | [`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) — Liste + Kanban grid (filters, pagination, date rules) | `router.refresh()` re-runs the server component tree. |
| **TanStack Query** | Trip detail sheet, unplanned widget, etc. | `invalidateQueries({ queryKey: tripKeys… })` |

Those are **different caches**. A change that only invalidates Query does **not** reload the main Fahrten table; a change that only calls `router.refresh()` does **not** update Query-backed hooks unless you invalidate too.

## Single entry point: `refreshTripsPage()`

[`TripsRscRefreshProvider`](../src/features/trips/providers/trips-rsc-refresh-provider.tsx) exposes **`refreshTripsPage()`**, which:

1. Awaits **`router.refresh()`** (RSC payload for Liste/Kanban).
2. Awaits **`queryClient.invalidateQueries({ queryKey: tripKeys.all })`** so client trip queries stay aligned.

Feature code on the Fahrten route should call **`useTripsRscRefresh().refreshTripsPage()`** instead of raw `router.refresh()` so both layers stay in sync and **`isRscRefreshPending`** can drive a subtle busy UI (top strip via [`TripsRscRefreshChrome`](../src/features/trips/components/trips-rsc-refresh-chrome.tsx)).

## Realtime

[`TripsRealtimeSync`](../src/features/trips/components/trips-realtime-sync.tsx) debounces Supabase `postgres_changes` on `trips` and calls **`refreshTripsPage()`** so bursts of events do not hammer the server.

## Components used outside Fahrten

Dialogs or hooks also used on **overview** (no `TripsRscRefreshProvider`) use **`useOptionalTripsRscRefresh()`**: if `null`, they fall back to `router.refresh()` + `invalidateQueries(tripKeys.all)` (same net effect, no shared pending state).

## Kanban staged edits

[`TripsKanbanBoard`](../src/features/trips/components/kanban/kanban-board.tsx) builds **`effectiveTrips`** from server **`trips`** plus **`pendingChanges`**. RSC refresh updates **`trips`** only; **unsaved** pending edits remain until Speichern or Verwerfen.

## Where things live

```text
src/features/trips/providers/
  trips-rsc-refresh-provider.tsx   # TripsRscRefreshProvider, useTripsRscRefresh, useOptionalTripsRscRefresh
  index.ts
src/features/trips/components/
  trips-realtime-sync.tsx
  trips-rsc-refresh-chrome.tsx     # aria-busy + top progress strip
src/app/dashboard/trips/
  fahrten-page-shell.tsx           # wraps route with TripsRscRefreshProvider
  page.tsx
src/query/
  realtime-bridge.ts               # createDebouncedCallback (shared debounce helper)
```

## Related docs

- [trips-date-filter.md](trips-date-filter.md) — date filter / “stuck cards” behaviour for the same RSC query.
- [server-state-query.md](server-state-query.md) — TanStack Query overview.
