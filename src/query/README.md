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
- [`keys/reference.ts`](keys/reference.ts) — `referenceKeys.drivers()`, `referenceKeys.payers()`, `referenceKeys.billingTypes(payerId)` for small reference lists reused across Fahrten filters, `DriverSelectCell`, Kanban, and trip forms. Fetched via [`use-trip-reference-queries.ts`](../features/trips/hooks/use-trip-reference-queries.ts) with a longer `staleTime` (see that file). **`referenceKeys.rechnungsempfaenger()`** — active recipients for Kostenträger / Rechnungs-Builder selects; **`referenceKeys.billingPricingRules(payerId)`** — `billing_pricing_rules` rows for the open Kostenträger (`useBillingPricingRules` invalidates after create/update/delete).

### Kostenträger: two query keys (admin vs trip UI)

- **Admin list** ([`usePayers`](../features/payers/hooks/use-payers.ts)): `queryKey: ['payers']`, full rows including `billing_types(count)` for the Kostenträger page.
- **Trip / filter reference** (`referenceKeys.payers()`): slim `id, name, kts_default` for **Neue Fahrt** and shared pickers.

`updatePayer` / `createPayer` invalidate **both** keys so trip forms immediately see `kts_default` and the admin cache stays aligned. The detail sheet ([`payer-details-sheet.tsx`](../features/payers/components/payer-details-sheet.tsx)) also resolves the open row from the `usePayers()` cache so the UI updates after save without relying only on the parent’s click snapshot.

### Reference data invalidation

Drivers/payers/billing types change rarely. **Usually no invalidation** — fresh data arrives on full reload or when the Query cache goes stale and refetches on focus. After admin actions that add/remove drivers or payers (if the UI stays mounted), call `queryClient.invalidateQueries({ queryKey: referenceKeys.root })` or narrow to e.g. `referenceKeys.drivers()`. If the app ever reuses one `QueryClient` across Clerk org switches without remounting, invalidate `referenceKeys` when the active organization changes so RLS-scoped lists cannot leak between tenants.

## Further reading

- [TanStack Query — Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [docs/server-state-query.md](../../docs/server-state-query.md) — project notes
- [docs/trips-page-rsc-refresh.md](../../docs/trips-page-rsc-refresh.md) — Fahrten RSC + Query coordination
