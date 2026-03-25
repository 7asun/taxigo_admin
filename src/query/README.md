# Client server state (`src/query/`)

TanStack Query (**React Query**) caches server data in the browser. This folder holds **shared defaults** and **query key factories** — not domain API calls (those stay in `features/*/api`).

## When to use what

| Situation | Use |
|-----------|-----|
| Data loaded in a **client hook** (`useQuery`) | `queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) })` after mutations or when Supabase realtime fires. |
| **Next.js Server Components** that `fetch` on the server | `router.refresh()` to re-run the server tree — **not** a substitute for Query cache on the client. |
| Both apply (e.g. Fahrten list + trip detail) | Use **`refreshTripsPage()`** from [`TripsRscRefreshProvider`](../features/trips/providers/trips-rsc-refresh-provider.tsx) on `/dashboard/trips` — it runs **`router.refresh()`** and **`invalidateQueries({ queryKey: tripKeys.all })`**. [`TripsRealtimeSync`](../features/trips/components/trips-realtime-sync.tsx) calls that same helper (debounced). **`tripKeys.all`** invalidation is intentional so detail/unplanned caches do not go stale when the RSC grid updates. |

## Policy: invalidation (Option A)

After a mutation or realtime event, **invalidate** the relevant query key(s). TanStack Query refetches in the background: **`isFetching`** may be true, but **`isPending`** stays false when cached data exists — **no full-page skeleton flash** for the trip sheet.

Do **not** merge `payload.new` from realtime into the cache with `setQueryData` unless you have a measured need (keeps one source of truth: `getTripById`).

## `staleTime`

The global default is set in [`query-client.ts`](query-client.ts). While data is **fresh**, Query won’t refetch on mount unless you invalidate. **Stale** data may still refetch on window focus (`refetchOnWindowFocus`).

## Keys

- [`keys/trips.ts`](keys/trips.ts) — `tripKeys.detail(id)` for trip detail; `tripKeys.unplanned(filter)` / `tripKeys.unplannedRoot` for the dashboard **Offene Touren** list (`useUnplannedTrips`).

## Further reading

- [TanStack Query — Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [docs/server-state-query.md](../../docs/server-state-query.md) — project notes
- [docs/trips-page-rsc-refresh.md](../../docs/trips-page-rsc-refresh.md) — Fahrten RSC + Query coordination
