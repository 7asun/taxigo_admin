# Server state (TanStack Query) in this project

## Location

- **Defaults + key factories:** [`src/query/`](../src/query/)
- **Trip detail hook:** [`src/features/trips/hooks/use-trips.ts`](../src/features/trips/hooks/use-trips.ts) (`useTripQuery` / `useTrip`)

## Trip detail UX

The trip detail sheet uses `useQuery` + `tripKeys.detail(id)` instead of manual `useState` + `setIsLoading(true)` on every refetch. That way:

- **First load:** skeleton while `isPending` and no data.
- **Save notes / time / after realtime:** background refetch — **no** full skeleton if data already exists.

## Realtime

Supabase `postgres_changes` on the trip row calls **`queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) })`** (see `useTripQuery` implementation). Optional debouncing can be added if events are noisy.

## RSC vs client cache

The Fahrten **list/kanban** grid is loaded by **Server Components** (`trips-listing.tsx`). Updates go through **`refreshTripsPage()`** from [`TripsRscRefreshProvider`](../src/features/trips/providers/trips-rsc-refresh-provider.tsx), which runs **`router.refresh()`** and **`invalidateQueries(tripKeys.all)`** so RSC and TanStack Query stay aligned. See **[docs/trips-page-rsc-refresh.md](trips-page-rsc-refresh.md)** for the full picture, file layout, and Kanban behaviour.

Client-side trip detail and other widgets use **Query** keys (`tripKeys.detail`, `tripKeys.unplanned`, …) — both layers are intentional.
