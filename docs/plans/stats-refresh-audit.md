# Stats Refresh Audit

## File Map

- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/page.tsx` - Dashboard entry page (redirects to overview)
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/layout.tsx` - Dashboard layout wrapper with auth guard
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/dashboard/overview/layout.tsx` - Main dashboard overview layout with stat cards
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/components/stats-card.tsx` - Stat card UI component (presentational only)
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/components/pending-tours-widget.tsx` - Unplanned trips widget
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/components/timeless-rule-trips-widget.tsx` - Timeless rule trips widget
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/hooks/use-timeless-rule-trips.ts` - Hook for timeless rule trips data
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/hooks/use-unplanned-trips.ts` - Hook for unplanned trips data
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/trips/hooks/use-trips.ts` - Hook for all trips data (LEGACY, not using React Query)
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/hooks/use-invoice-revenue-total.ts` - Hook for invoice revenue total stat
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/components/layout/providers.tsx` - React Query provider setup
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/app/layout.tsx` - Root layout
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/query-client.ts` - QueryClient configuration
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/trips.ts` - Trip query key factories
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/keys/invoices.ts` - Invoice query key factories
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/query/realtime-bridge.ts` - Debounced invalidation utilities
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/trips/api/trips.service.ts` - Trips API service
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/api/invoices.api.ts` - Invoices API service
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/dashboard/lib/stats-utils.ts` - Stat calculation utilities
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/trips/hooks/use-update-trip-mutation.ts` - Trip update mutation
- `/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/src/features/invoices/hooks/use-invoice.ts` - Invoice mutations

## Query Key Structure

### useTrips() (LEGACY - NOT using React Query)
- **No query key**: This hook does NOT use TanStack Query. It uses manual `useState` + `useEffect` with direct Supabase client calls.
- **Data source**: `tripsService.getTrips()` which does `supabase.from('trips').select('*').order('scheduled_at', { ascending: false })`

### useInvoiceRevenueTotal()
- **Query key**: `invoiceKeys.revenueTotal` = `['invoices', 'revenue-total']` (static key)
- **Data source**: `getInvoiceRevenueTotal()` which does `supabase.from('invoices').select('total').in('status', ['sent', 'paid'])` and sums client-side

### useTimelessRuleTrips()
- **Query key**: `tripKeys.timelessRuleTrips(tomorrowDateStr)` = `['trips', 'timeless-rules', requestedDate]` (dynamic by date)
- **Data source**: Custom Supabase query with joins on payers and billing_variants

### useUnplannedTrips()
- **Query key**: `tripKeys.unplanned(filter)` = `['trips', 'unplanned', filter]` (dynamic by filter: 'today' | 'week' | 'all')
- **Data source**: Custom Supabase query with linked trip enrichment

## staleTime / gcTime

### Global defaults (query-client.ts)
- **staleTime**: 60,000ms (60 seconds)
- **refetchOnWindowFocus**: true
- **retry**: 1

### Per-query overrides
- **useInvoiceRevenueTotal()**: 5 minutes (300,000ms) - explicitly set
- **useTimelessRuleTrips()**: 60,000ms (1 minute) - explicitly set
- **useUnplannedTrips()**: 60,000ms (1 minute) - explicitly set
- **useTrips()**: N/A - not using React Query

**Assessment**: staleTime values are reasonable (1-5 minutes). The 5-minute staleTime on invoice revenue is appropriate for a stat that doesn't need real-time precision.

## refetchOnWindowFocus

- **Global setting**: Enabled (true in query-client.ts)
- **Per-query overrides**: None found for stat queries

**Assessment**: Window focus refetch is enabled globally, so stats should refetch when the user returns to the tab (after staleTime expires).

## Mutation Invalidation Gaps

### Trip mutations

**useUpdateTripMutation()** (use-update-trip-mutation.ts):
- Invalidates: `tripKeys.detail(id)` only
- **MISSING**: Does NOT invalidate `tripKeys.all` or any dashboard stat keys

**Direct tripsService.updateTrip() calls** (found in multiple files):
- `pending-tours-widget.tsx`: Invalidates `tripKeys.unplannedRoot` and `tripKeys.detail(id)` ✓
- `timeless-rule-trips-widget.tsx`: Invalidates `tripKeys.detail(id)` and `tripKeys.timelessRuleTripsRoot` ✓
- `trip-detail-sheet.tsx`: Invalidates various keys but NOT `tripKeys.all` ✗
- `create-trip-form.tsx`: No invalidation found after `createTrip` ✗
- `kanban-board.tsx`: No invalidation found after `updateTrip` ✗

**CRITICAL GAP**: The legacy `useTrips()` hook is not integrated with React Query at all, so invalidation via `invalidateQueries` has no effect on it. It relies solely on Supabase realtime subscription.

### Invoice mutations

**useUpdateInvoiceStatus()** (use-invoice.ts):
- Invalidates: `invoiceKeys.all` (onSettled)
- **MISSING**: Does NOT invalidate `invoiceKeys.revenueTotal`

**createInvoice()**:
- No invalidation found in the invoice builder hook
- **MISSING**: Should invalidate `invoiceKeys.revenueTotal` after invoice creation

**CRITICAL GAP**: When invoices are created or their status changes (draft → sent → paid), the `invoiceKeys.revenueTotal` query is never invalidated. This means the "Rechnungsumsatz" stat card on the dashboard will not refresh until the 5-minute staleTime expires or the user does a full page reload.

### Summary of missing invalidations

1. **Trip create/update/delete**: Should invalidate `tripKeys.all` (for the legacy useTrips hook - though this won't help since it doesn't use React Query)
2. **Invoice create/status update**: Should invalidate `invoiceKeys.revenueTotal`
3. **Legacy useTrips hook**: Cannot be invalidated via React Query at all - this is the root cause

## Data Source

### Trips data (for "Fahrten heute" and "Umsatz heute" stats)
- **Source**: Raw `trips` table via `tripsService.getTrips()`
- **Query**: `supabase.from('trips').select('*').order('scheduled_at', { ascending: false })`
- **Aggregation**: Client-side filtering by date using `getTripsForDay()` and `calculateTotalRevenue()` in stats-utils.ts
- **Note**: Fetches ALL trips, then filters client-side - not efficient for large datasets

### Invoice revenue data (for "Rechnungsumsatz" stat)
- **Source**: Raw `invoices` table via `getInvoiceRevenueTotal()`
- **Query**: `supabase.from('invoices').select('total').in('status', ['sent', 'paid'])`
- **Aggregation**: Client-side sum of `total` field
- **Note**: Could be optimized with a Postgres view or RPC function

## Component Mounting Behaviour

### Dashboard layout
- **Location**: `/src/app/dashboard/layout.tsx`
- **Scope**: Wraps all dashboard routes (overview, trips, invoices, etc.)
- **Persistence**: Mounted once when user enters any dashboard route, persists across navigation within dashboard

### Overview layout
- **Location**: `/src/app/dashboard/overview/layout.tsx`
- **Scope**: Only the overview page
- **Mounting**: Remounts when navigating to/from `/dashboard/overview`
- **Hooks mounted**:
  - `useTrips()` - legacy hook, loads ALL trips
  - `useInvoiceRevenueTotal()` - React Query hook
  - `useTimelessRuleTrips()` - React Query hook (via TimelessRuleTripsWidget)
  - `useUnplannedTrips()` - React Query hook (via PendingToursWidget)

**Assessment**: The overview layout remounts on each visit to the overview page, which should trigger fresh data fetches. However, the legacy `useTrips()` hook's data persists in its internal state and only refreshes via Supabase realtime.

## Root Cause Assessment

**Primary root cause**: The legacy `useTrips()` hook does not use TanStack Query. It uses manual state management (`useState`) with a Supabase realtime subscription. This means:

1. **No React Query integration**: The hook cannot be invalidated via `queryClient.invalidateQueries()`
2. **Dependent stats cannot refresh**: The "Fahrten heute" and "Umsatz heute" stats are computed from `useTrips()` data in the overview layout. Since the parent hook doesn't refresh via invalidation, the derived stats don't refresh either.
3. **Realtime only works for trips table changes**: The Supabase realtime subscription in `useTrips()` only listens to the `trips` table. If a trip is created/updated via a different client or the subscription is dropped, the stats won't refresh until the user reloads the page.

**Secondary root cause**: The `invoiceKeys.revenueTotal` query is never invalidated after invoice mutations (create, status update). This causes the "Rechnungsumsatz" stat to remain stale until the 5-minute staleTime expires.

**Root cause classification**: **combination** of:
- Legacy hook not using React Query (primary)
- Missing invalidation for invoice revenue stat (secondary)

## Recommended Fix Options

### Option 1: Migrate useTrips() to TanStack Query (RECOMMENDED)

**Changes**:
- Rewrite `useTrips()` in `/src/features/trips/hooks/use-trips.ts` to use `useQuery` instead of `useState` + manual Supabase calls
- Use query key `tripKeys.all` or a new key like `tripKeys.list()`
- Keep the Supabase realtime subscription but use it to call `queryClient.invalidateQueries({ queryKey: tripKeys.all })` instead of `fetchTrips()`
- Update all trip mutation hooks to invalidate `tripKeys.all` after mutations

**Files touched**:
- `src/features/trips/hooks/use-trips.ts` (major rewrite)
- `src/features/trips/hooks/use-update-trip-mutation.ts` (add tripKeys.all invalidation)
- `src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts` (already invalidates tripKeys.all - verify)
- Any other files calling tripsService.createTrip/updateTrip/deleteTrip (add invalidation)

**Trade-offs**:
- **Pros**: Clean integration with React Query ecosystem, consistent invalidation patterns, leverages existing infrastructure, fixes both trip stats and makes future enhancements easier
- **Cons**: Requires careful testing of the realtime subscription integration, potential breaking changes if other code depends on the current hook's API

**Effort**: Medium (2-3 hours)

### Option 2: Add invoice revenue invalidation + keep useTrips() as-is

**Changes**:
- Add `invoiceKeys.revenueTotal` invalidation to `useUpdateInvoiceStatus` in `src/features/invoices/hooks/use-invoice.ts`
- Add `invoiceKeys.revenueTotal` invalidation to the invoice builder after `createInvoice` in `src/features/invoices/hooks/use-invoice-builder.ts`
- For the legacy `useTrips()` issue, add a manual `refresh()` call to the overview layout that users can trigger, or add polling

**Files touched**:
- `src/features/invoices/hooks/use-invoice.ts` (add revenueTotal invalidation)
- `src/features/invoices/hooks/use-invoice-builder.ts` (add revenueTotal invalidation)
- `src/app/dashboard/overview/layout.tsx` (optional: add refresh button or polling)

**Trade-offs**:
- **Pros**: Quick fix for invoice stat, minimal changes
- **Cons**: Does not fix the root cause (legacy useTrips hook), trip stats still won't refresh properly, technical debt remains

**Effort**: Low (30 minutes)

### Option 3: Add polling to overview layout

**Changes**:
- Add `refetchInterval` to `useInvoiceRevenueTotal()` hook (e.g., 2-3 minutes)
- For the legacy `useTrips()` hook, add a `setInterval` in the overview layout to call `refresh()` every 2-3 minutes
- Keep all other code as-is

**Files touched**:
- `src/features/invoices/hooks/use-invoice-revenue-total.ts` (add refetchInterval)
- `src/app/dashboard/overview/layout.tsx` (add polling for useTrips refresh)

**Trade-offs**:
- **Pros**: Simple implementation, guaranteed refresh regardless of mutations
- **Cons**: Unnecessary network traffic, stats may still be stale between polls, doesn't address the architectural issue, adds complexity to the overview layout

**Effort**: Low (30 minutes)

## Senior Recommendation

**Implement Option 1** (migrate `useTrips()` to TanStack Query) with the following approach:

1. **Phase 1**: Rewrite `useTrips()` to use `useQuery` with key `tripKeys.all`
   - Keep the Supabase realtime subscription but use debounced invalidation via `createDebouncedInvalidateByQueryKey`
   - Ensure the hook's API remains compatible (returns `{ trips, isLoading, error, refresh }`)

2. **Phase 2**: Add `tripKeys.all` invalidation to all trip mutations
   - Update `useUpdateTripMutation` to invalidate both `tripKeys.detail(id)` and `tripKeys.all`
   - Add invalidation to `createTrip` and `deleteTrip` mutations
   - Verify existing invalidation calls in trip-detail-sheet and other components

3. **Phase 3**: Fix invoice revenue invalidation
   - Add `invoiceKeys.revenueTotal` invalidation to `useUpdateInvoiceStatus`
   - Add `invoiceKeys.revenueTotal` invalidation to invoice builder after `createInvoice`

This approach addresses the root architectural issue, brings the codebase to a consistent pattern, and ensures all stats refresh properly via React Query's invalidation mechanism. The investment now will pay dividends in maintainability and feature development going forward.
