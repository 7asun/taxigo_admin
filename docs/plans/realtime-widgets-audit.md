# Realtime Widgets Audit

## 1. Layout Realtime Subscription

`src/app/dashboard/overview/layout.tsx` does **not** contain any Supabase Realtime subscription.

There is no `supabase.channel(...)`, `.on(...)`, or `.subscribe()` call in this layout file, so there is no channel definition to paste from `layout.tsx`.

## 2. Exact Query Keys

### `useTimelessRuleTrips`

Defined in `src/features/dashboard/hooks/use-timeless-rule-trips.ts`:

```ts
queryKey: tripKeys.timelessRuleTrips(todayYmd, tomorrowYmd)
```

Factory definition from `src/query/keys/trips.ts`:

```ts
['trips', 'timeless-rules', todayYmd, tomorrowYmd]
```

### Pending Tours Query

`src/features/dashboard/components/pending-tours-widget.tsx` calls:

```ts
useUnplannedTrips(filter)
```

`src/features/dashboard/hooks/use-unplanned-trips.ts` uses:

```ts
queryKey: tripKeys.unplanned(filter)
```

Factory definition from `src/query/keys/trips.ts`:

```ts
['trips', 'unplanned', filter]
```

Where `filter` is one of:

```ts
'today' | 'week' | 'all'
```

### Other Queries In These Two Widgets

`src/features/dashboard/components/timeless-rule-trips-widget.tsx` also has a payer reference query:

```ts
queryKey: referenceKeys.payers()
```

Factory definition from `src/query/keys/reference.ts`:

```ts
['reference', 'payers']
```

`src/features/dashboard/components/pending-tours-widget.tsx` also loads drivers, but it is a direct Supabase `useEffect` fetch from `accounts`, not a TanStack Query query, so it has no query key.

## 3. `invalidateAfterTripSave` Invalidations

Defined in `src/features/trips/lib/invalidate-after-trip-save.ts`.

For each supplied trip id:

```ts
void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
```

Exact key:

```ts
['trips', 'detail', id]
```

When `includeTripList` is true, which is the default:

```ts
void queryClient.invalidateQueries({ queryKey: tripKeys.all });
```

Exact key:

```ts
['trips']
```

When planning widgets should be invalidated:

```ts
void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
void queryClient.invalidateQueries({
  queryKey: tripKeys.timelessRuleTripsRoot
});
```

Exact keys:

```ts
['trips', 'unplanned']
['trips', 'timeless-rules']
```

Yes, `invalidateAfterTripSave` accepts:

```ts
includePlanningWidgets?: boolean | 'auto'
```

Behavior:

- `true`: always invalidates `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot`.
- `'auto'`: invalidates those widget roots only if `patch` touches one of `scheduled_at`, `requested_date`, `status`, `driver_id`, `fremdfirma_id`, `rule_id`, `linked_trip_id`, or `link_type`.
- `false` or omitted: skips the planning widget root invalidations.

## 4. Supabase Client Access In Layout

`src/app/dashboard/overview/layout.tsx` does **not** import or call `createClient`, and it does not use a `useSupabase` hook.

The browser-client pattern used elsewhere is:

```ts
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
```

`src/lib/supabase/client.ts` wraps `createBrowserClient` from `@supabase/ssr` and returns a memoized browser `SupabaseClient`.

Examples in the audited files:

- `useUnplannedTrips` creates the client inside its realtime `useEffect`.
- `useTimelessRuleTrips` creates the client inside its realtime `useEffect`.
- `PendingToursWidget` creates the client inside a `useEffect` to fetch drivers from `accounts`.
- `tripsService` creates the client inside each service method.

## 5. Existing Layout Effects Or Subscriptions

`src/app/dashboard/overview/layout.tsx` has no `useEffect` calls and no subscription hooks of its own.

However, child hooks mounted by this layout already create Realtime subscriptions:

```ts
supabase
  .channel('unplanned-trips-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'trips' },
    () => {
      schedule();
    }
  )
  .subscribe();
```

```ts
supabase
  .channel('timeless-rule-trips-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'trips' },
    () => {
      schedule();
    }
  )
  .subscribe();
```

So there is no direct conflict inside `layout.tsx`, but adding a new layout-level `trips` Realtime channel without changing the existing widget hooks would duplicate subscriptions and invalidations for the same table events.

## 6. Tables Read By The Widgets

### Pending Tours Widget

The pending tours data path is:

- `PendingToursWidget`
- `useUnplannedTrips(filter)`
- `fetchUnplannedTrips(filter)`

Tables read:

- `trips`: primary unplanned rows.
- `trips`: linked partner rows via `.in('id', linkedIds)`.
- `accounts`: joined through `driver:accounts!trips_driver_id_fkey(name)` from `ASSIGNEE_JOIN_FRAGMENT`.
- `fremdfirmen`: joined through `fremdfirma:fremdfirmen(id, name, default_payment_mode)` from `ASSIGNEE_JOIN_FRAGMENT`.
- `accounts`: direct driver dropdown fetch in `PendingToursWidget` with `.from('accounts').select('id, name').eq('role', 'driver')`.

### Timeless Rule Trips Widget

The timeless rule trips data path is:

- `TimelessRuleTripsWidget`
- `useTimelessRuleTrips()`
- `fetchTimelessRulePairs(todayYmd, tomorrowYmd)`

Tables read:

- `trips`: primary timeless rule rows.
- `trips`: linked partner rows via `.in('id', linkedIds)`.
- `payers`: embedded as `payer:payers(name)` in the timeless trips query.
- `billing_variants`: embedded as `billing_variant:billing_variants!trips_billing_variant_id_fkey(...)`.
- `billing_types`: embedded through `billing_variants` for `name` and `color`.
- `payers`: payer filter query via `fetchPayers()` and `referenceKeys.payers()`.
