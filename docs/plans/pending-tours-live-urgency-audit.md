# Pending Tours — Live Urgency Refresh Audit

**Scope:** Why the **Offene Touren** widget (`PendingToursWidget`) can appear to require hot reload or full page refresh before urgency border colors update — and how React Query, local timers, and realtime interact.

**Date:** 2026-06-12  
**Status:** Post-save fixes applied — awaited `invalidateQueries(tripKeys.unplannedRoot)` plus form-state sync from refreshed trip props (see `docs/urgency-indicator.md`).

---

## Files read

### Seed set

| File | Role |
|------|------|
| `src/features/dashboard/components/pending-tours-widget.tsx` | Widget UI, `useUrgencyLevel` on row border |
| `src/features/dashboard/hooks/use-unplanned-trips.ts` | Query + realtime invalidation |
| `src/features/trips/hooks/use-urgency-level.ts` | 10s live urgency hook |
| `src/features/trips/lib/urgency-logic.ts` | Pure level calculation |
| `src/features/trips/constants/urgency-config.ts` | `URGENCY_STYLES.rowClass` |
| `src/features/trips/components/trips-tables/index.tsx` | Fahrten row classes (static) |
| `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | Mobile cards inherit static row class + live dot |
| `src/features/trips/components/urgency-indicator.tsx` | Dot/badge with 10s interval |
| `src/features/trips/components/kanban/kanban-trip-card.tsx` | Live chip via hook |
| `src/query/keys/index.ts` | Query key barrel |
| `src/query/keys/trips.ts` | `tripKeys.unplanned*` |

### Additional consumers / infrastructure

| File | Role |
|------|------|
| `src/query/query-client.ts` | App-wide `QueryClient` defaults |
| `src/components/layout/providers.tsx` | `QueryClientProvider` |
| `src/query/realtime-bridge.ts` | Debounced `invalidateQueries` helper |
| `src/query/README.md` | Invalidation policy |
| `src/features/trips/hooks/use-trips.ts` | Trip detail realtime pattern |
| `src/features/trips/components/trips-realtime-sync.tsx` | Fahrten page RSC + `tripKeys.all` invalidation |
| `src/features/dashboard/hooks/use-timeless-rule-trips.ts` | Peer dashboard widget realtime |
| `src/app/dashboard/overview/layout.tsx` | Mounts `PendingToursWidget` |

### Grep inventory

| Symbol | Importers |
|--------|-----------|
| `useUnplannedTrips` | `pending-tours-widget.tsx` only |
| `useUrgencyLevel` | `pending-tours-widget.tsx`, `kanban-trip-card.tsx` |
| `tripKeys.unplannedRoot` invalidation | `use-unplanned-trips.ts` (realtime), `pending-tours-widget.tsx` (`handleSetTime`) |

**No `refetchInterval`** is configured anywhere under `src/` for dashboard widgets or trip lists.

---

## 1. Why does Pending Tours appear to need hot reload for urgency colors?

### Short answer

The symptom is usually **two different problems conflated**:

| Symptom | Primary cause | Needs network? |
|---------|---------------|----------------|
| Border color does not change as clock time crosses urgency windows (e.g. 30m → 10m before trip) | **Local tick / render** — was broken before `useUrgencyLevel`; should work now with up to **10s delay** | No |
| Border does not appear after saving time in the widget, or row does not disappear after assigning driver | **React Query cache** — `trip.scheduled_at` / list membership update only after invalidation + refetch | Yes |
| Colors match Kanban dots but Fahrten **row** borders feel “stuck” | **Pre-existing product inconsistency** — Fahrten row borders are static; dots are live | Mixed |

Hot reload / full refresh **forces** both: (1) remount → hook runs `update()` immediately, and (2) query refetch → fresh `trip` props. That masks which layer was actually stale.

### Detailed breakdown

#### A. Time passing alone (urgency level transitions)

**Should update without any network refetch.**

`useUrgencyLevel` in `UnplannedTripRow` runs:

```ts
setInterval(() => setLevel(getUrgencyLevel(scheduledAt, status)), 10000);
```

Each `setLevel` re-renders the row; `URGENCY_STYLES[urgencyLevel].rowClass` is recomputed and merged via `cn()` on the root `div`.

**If this still feels “stuck” without refresh:**

1. **10-second resolution** — level only recomputes on mount, when `scheduled_at`/`status` props change, or every 10s. Crossing an urgency boundary can take up to ~10s; that is not a refresh bug but can feel like one.
2. **Background tab throttling** — browsers throttle `setInterval` in inactive tabs (often to ≥1 minute). Urgency will appear frozen until the tab is focused or the page is reloaded.
3. **Pre-implementation state** — before `useUrgencyLevel` was wired, row borders were effectively **static** until any parent re-render (same bug class as Fahrten table row borders today).
4. **`scheduled_at` is null in props** — urgency stays `none` until server data shows a time (see B).

**Not caused by:** `staleTime`, realtime, or `dateStr` / `time` / `driverId` local form state (urgency reads `trip.scheduled_at` and `trip.status` from props only).

#### B. Fresh server data required

These **cannot** be solved by the urgency timer alone:

| Event | Why refresh/refetch matters |
|-------|----------------------------|
| User submits time + driver in widget | `trip.scheduled_at` in React Query cache is unchanged until `invalidateQueries` → refetch completes |
| Another dispatcher assigns driver elsewhere | Same — needs realtime invalidation or focus refetch |
| Row should leave the list | Query predicate `scheduled_at IS NULL OR driver_id IS NULL` — row removal is 100% server-driven |
| Linked partner cancelled badge | `linked_trip` embed from fetch — needs refetch |

#### C. Local row state (does not block urgency ticks)

`UnplannedTripRow` initializes `dateStr`, `time`, `driverId` from trip once via `useState(initial*)` and does **not** sync when the `trip` prop updates after refetch (except new mount via `key={trip.id}`).

| State | Affects urgency border? | Affects perceived freshness? |
|-------|-------------------------|------------------------------|
| `dateStr`, `time`, `driverId` | No | Yes — form can disagree with server until refetch |
| `setTime('')` after successful save | No | Clears input while cache may still show old/null `scheduled_at` briefly |

### What should update from time alone vs server data

| Concern | Driver |
|---------|--------|
| Urgency border color / `rowClass` | **Local timer** (`useUrgencyLevel`) + `trip.scheduled_at` + `trip.status` **as currently cached** |
| Row in/out of widget list | **Server** + React Query refetch |
| CardDescription counts (“X ohne Zeit”) | **Server** + parent re-render from query |
| Form input values after external edit | **Needs prop sync** (not implemented today) |

---

## 2. How does `useUnplannedTrips` work?

### React Query configuration

```ts
useQuery({
  queryKey: tripKeys.unplanned(filter),  // ['trips', 'unplanned', 'today' | 'week' | 'all']
  queryFn: () => fetchUnplannedTrips(filter),
  staleTime: 60_000
});
```

| Option | Value | Notes |
|--------|-------|-------|
| **queryKey** | `['trips', 'unplanned', filter]` | One cache entry per tab filter |
| **staleTime** | `60_000` ms | Matches global default in `query-client.ts` |
| **gcTime** | Not set | TanStack Query v5 default (`5 * 60_000` ms) |
| **refetchOnMount** | Default `true` | Refetches on mount **only if stale** |
| **refetchOnWindowFocus** | Default `true` (global) | Refetches stale queries on focus |
| **refetchOnReconnect** | Default `true` | Not overridden |
| **refetchInterval** | **Not set** | No polling |
| **select** | None | Transform happens inside `queryFn` |
| **placeholderData / initialData** | None | |

### `queryFn` behavior (`fetchUnplannedTrips`)

1. Supabase `trips` select: `.or('scheduled_at.is.null,driver_id.is.null')`, exclude cancelled/completed.
2. Second query for linked trip metadata (`scheduled_at`, `status`, `link_type`).
3. Client filter for `today` / `week` / `all` (browser-local `isToday` / `isThisWeek` — separate TZ concern).
4. Sort by `scheduled_at` ascending (nulls last among timed rows).

### Realtime behavior

`useEffect` in `useUnplannedTrips`:

- Subscribes to `postgres_changes` on `public.trips` (`event: '*'`).
- On each event → `createDebouncedInvalidateByQueryKey(queryClient, tripKeys.unplannedRoot, 400)`.
- Prefix key `['trips', 'unplanned']` invalidates **all** filter variants.

**No polling.** Freshness for list membership and `scheduled_at` values depends on:

- Initial fetch
- `invalidateQueries` (mutation, realtime, debounced)
- Window focus / reconnect when data is stale (>60s)

### Return shape

```ts
{ trips: query.data ?? [], isLoading: query.isLoading, error, refresh: query.refetch }
```

`isLoading` is **initial load only** (`isLoading`, not `isPending`) — background refetch does not skeleton the card.

---

## 3. What should update instantly without a network refetch?

| Behavior | Mechanism | Network? |
|----------|-----------|----------|
| Urgency **border color** transitions as clock advances | `useUrgencyLevel` → `setInterval` 10s | **No** |
| Urgency **dot** in Fahrten Zeit column | `UrgencyIndicator` internal 10s interval | **No** |
| Kanban **time chip** tint | `useUrgencyLevel` | **No** |
| Urgency **labels** in tooltips (Kanban/driver) | Same hooks / indicator | **No** |
| Row **appears** in Offene Touren | Trip became unplanned in DB | **Yes** |
| Row **disappears** after time + driver set | DB row no longer matches OR filter | **Yes** |
| Border **first appears** after user saves time in widget | Cache `trip.scheduled_at` must update | **Yes** (invalidation → refetch) |
| CardDescription “N ohne Zeit / Fahrer” | Derived from `trips` array | **Yes** (query update) |
| Cancelled-partner badge | `linked_trip.status` embed | **Yes** |

### Recommended responsibility split

| Layer | Responsibility |
|-------|----------------|
| **`useUrgencyLevel`** | Time-based visual level from cached `scheduled_at` + `status` |
| **`invalidateQueries(unplannedRoot)`** | After widget mutation; already present in `handleSetTime` |
| **Supabase realtime on `trips`** | Cross-session / cross-tab list freshness; already in hook |
| **Polling** | Not needed for urgency colors; avoid unless realtime proves unreliable |

---

## 4. Existing urgency live-update patterns (comparison)

| Consumer | Row / chip styling | Live every ~10s? | Implementation |
|----------|-------------------|------------------|----------------|
| **Pending Tours** (`UnplannedTripRow`) | `URGENCY_STYLES.rowClass` on root `div` | **Yes** | `useUrgencyLevel` |
| **Kanban** (`kanban-trip-card.tsx`) | `KANBAN_TIME_CHIP_CLASS` on time wrapper | **Yes** | `useUrgencyLevel` |
| **UrgencyIndicator** (dot/badge) | Dot/badge element | **Yes** | Internal `useState` + 10s `setInterval` |
| **Fahrten table** (`trips-tables/index.tsx`) | `getRowClassName` → `getUrgencyLevel` **once** | **No** | Static until parent re-renders |
| **Fahrten mobile cards** | Inherits `getRowClassName` (static) + dot (live) | **Partial** | Split brain: border static, dot live |
| **Overview TripRow** | Billing left border only; urgency = dot | Dot live only | `UrgencyIndicator` |

### Product inconsistency (pre-existing)

Fahrten **mobile card borders** and **desktop table row backgrounds** use the same `URGENCY_STYLES.rowClass` as Pending Tours but compute level with **one-shot** `getUrgencyLevel` in `getRowClassName`. Only the Zeit-column **dot** ticks.

Pending Tours (post-urgency PR) is actually **more correct** for row borders than Fahrten table/mobile — yet users comparing surfaces may believe “urgency rows don’t live-update” because Fahrten doesn’t.

---

## 5. Is Pending Tours embedding instant refresh correctly?

### Row border wiring (current code)

```tsx
const urgencyLevel = useUrgencyLevel(trip.scheduled_at, trip.status);
const urgencyRowClass = URGENCY_STYLES[urgencyLevel].rowClass;

<div className={cn('… neutral shell …', urgencyRowClass)}>
```

**Verdict:** Border styling is **directly driven** by the live hook inside the rendered row component — not a static one-time calculation. Re-renders are triggered by `setLevel` inside the hook, independent of parent `PendingToursWidget` re-renders.

### Can local state block live updates?

| State | Blocks urgency tick? |
|-------|---------------------|
| `dateStr`, `time`, `driverId` | **No** — urgency ignores these |
| `isSubmitting` | **No** |
| `initialTime` / `initialDate` | **No** — only seed `useState` |

### When borders stay neutral until “refresh”

1. **`trip.scheduled_at` is null in cache** — common for “time in form but not saved” or post-save before refetch.
2. **Urgency window is `none`** — >30m before, or >10m overdue per `urgency-logic.ts`.
3. **10s timer not elapsed yet** after boundary cross.
4. **Tab in background** — interval throttled.

### Post-mutation gap (real bug class)

`handleSetTime`:

```tsx
await tripsService.updateTrip(...);
void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
setTime('');
```

- Invalidation is **fire-and-forget** (`void`) — UI does not await refetch.
- Until refetch completes, `trip.scheduled_at` prop is **stale** → `useUrgencyLevel` still sees old/null time → **no new border**.
- Full page reload always refetches → borders appear → user attributes fix to “refresh”.

This is a **React Query freshness** issue, not a broken urgency hook.

---

## 6. Recommended architecture for this widget

```
┌─────────────────────────────────────────────────────────────┐
│  useUnplannedTrips (React Query + realtime invalidate)       │
│  • List membership, scheduled_at, status, linked_trip embed   │
└──────────────────────────┬──────────────────────────────────┘
                           │ trip props
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  UnplannedTripRow                                            │
│  • useUrgencyLevel(scheduled_at, status)  ← time-only visuals│
│  • URGENCY_STYLES[rowClass] on root div                     │
│  • Local form state (date/time/driver) ← UX only             │
└─────────────────────────────────────────────────────────────┘
```

| Mechanism | Use for | Avoid for |
|-----------|---------|-----------|
| **`useUrgencyLevel` (10s)** | Border color vs clock | List changes |
| **`invalidateQueries(unplannedRoot)`** | After widget save; already present | — |
| **Realtime `postgres_changes`** | Other dispatchers / tabs; already present | Sub-minute urgency (overkill) |
| **`refetchInterval` polling** | — | Urgency colors (wasteful) |
| **Optimistic `setQueryData`** | Optional: instant post-save `scheduled_at` | Required only if refetch latency is unacceptable |

**Smallest correct architecture:** Keep **local ticking for urgency** + **existing invalidation/realtime for data** — no polling.

Optional hardening (separate PRs):

1. `await queryClient.invalidateQueries(...)` after mutation (or `setQueryData` on unplanned cache).
2. `useEffect` to sync form state when `trip.id` / `trip.scheduled_at` changes after refetch.
3. Align Fahrten `getRowClassName` with `useUrgencyLevel` (product-wide consistency).

---

## 7. Query-key and invalidation gaps

### What `handleSetTime` invalidates today

| Key | Invalidated? |
|-----|--------------|
| `tripKeys.unplannedRoot` → all `['trips','unplanned',*]` | **Yes** |
| `tripKeys.detail(trip.id)` | **Yes** |
| `tripKeys.all` | **No** |
| `tripKeys.timelessRuleTripsRoot` | **No** |

For **this widget**, `unplannedRoot` is sufficient for row removal and updated `scheduled_at` **after refetch**.

### Gaps

| Gap | Impact |
|-----|--------|
| **No await on invalidation** | Border/list may lag until background refetch finishes |
| **No optimistic cache update** | User saves time → still sees neutral border briefly |
| **No form sync on prop change** | After refetch, inputs may not match server (urgency still correct from props) |
| **Fahrten RSC list** (`tripKeys.all` / `router.refresh`) | Not invalidated from widget — Fahrten page can lag until realtime/focus; **out of widget scope** |
| **Partial plan (time only, no driver)** | Row correctly stays in list; urgency should apply once `scheduled_at` is in cache |

Prefix invalidation `['trips','unplanned']` correctly matches `['trips','unplanned','today']` etc.

---

## 8. Polling vs realtime vs local ticking

### For urgency color / time transitions

| Approach | Verdict |
|----------|---------|
| **Local 10s timer (`useUrgencyLevel`)** | **Recommended** — zero network; already implemented |
| **React Query `refetchInterval`** | **Reject** — does not advance urgency without recomputing client-side; wastes Supabase reads |
| **Supabase realtime** | **Reject for urgency** — fires on data changes, not on clock |

### For rows appearing / disappearing / cross-user updates

| Approach | Verdict |
|----------|---------|
| **Realtime + debounced invalidate** | **Already implemented** — good for multi-dispatcher |
| **Polling** | Unnecessary if realtime works; 60s staleTime + focus refetch is backup |
| **Hybrid** | **Recommended:** local tick (urgency) + realtime invalidate (list) — **current design** |

### Trade-offs

| | Local tick | Polling | Realtime |
|--|------------|---------|----------|
| Network cost | None | High | Low (events only) |
| Clock-based urgency | Yes | No (unless recomputed client-side) | No |
| Cross-user list sync | No | Yes | Yes |
| Background tab | Throttled | Throttled | Events still invalidate (refetch on focus) |

---

## 9. Safest implementation path

### If urgency borders still require manual refresh

Diagnose **which** refresh is missing:

1. **Clock transitions (trip already has `scheduled_at` in list)** → verify hook mounted, wait ≥10s, tab focused. If still broken: inspect React devtools for row re-renders every 10s.
2. **After save in widget** → React Query lag; fix mutation → cache path, not urgency logic.
3. **Compared to Fahrten mobile** → Fahrten row border is **known static**; compare dot or Kanban chip instead.

### Files

| Category | Files |
|----------|-------|
| **Definitely required** (if post-save freshness is the issue) | `pending-tours-widget.tsx` — await invalidation and/or optimistic cache patch |
| **Likely required** (if form feels stale) | `pending-tours-widget.tsx` — sync local state when `trip` prop updates |
| **Optional consistency** | `trips-tables/index.tsx` — use `useUrgencyLevel` in row class path (larger change; extract row subcomponent) |
| **Remain untouched** | `urgency-logic.ts`, `use-urgency-level.ts` (unless changing tick interval), `use-unplanned-trips.ts` realtime shape, `query-client.ts` |

### Smallest safe next step

**No urgency-logic or query-architecture change.**

1. Confirm in browser: row with `scheduled_at` + no driver re-renders every 10s (React DevTools).
2. If **clock** issue persists → debug `useUrgencyLevel` mount/lifecycle only.
3. If **post-save** issue → in `handleSetTime`, `await queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot })` so `trip.scheduled_at` updates before user looks at the border; optionally patch unplanned cache with returned `updateTrip` row.

---

## 10. Tests and documentation gaps

### Missing coverage

| Area | Gap |
|------|-----|
| **`getUrgencyLevel`** | No unit tests for window boundaries / >10m overdue → `none` |
| **`useUrgencyLevel`** | No hook test proving interval calls `setLevel` |
| **`useUnplannedTrips`** | No test for invalidate + refetch updating row list |
| **Widget integration** | No test that row `className` changes when level changes without query refetch |
| **Post-mutation** | No test that border appears after save without full reload |
| **Cross-tab** | Manual expectation only (realtime invalidation) |

### Minimum documentation updates (`docs/`)

| Doc | Update |
|-----|--------|
| **`docs/urgency-indicator.md`** | Add “Live update expectations”: 10s resolution, background tab throttling, row borders need cached `scheduled_at` |
| **`docs/server-state-query.md` or `query/README.md`** | Note Offene Touren: urgency = client timer; list = invalidate/realtime |
| **`docs/plans/pending-tours-urgency-audit.md`** | Cross-link this live-refresh audit |

---

## Senior recommendation

### Is this primarily React Query, local ticking, or both?

**Both — different symptoms:**

| Problem | Primary layer |
|---------|---------------|
| “Border never changes as time passes” (with `scheduled_at` already on row) | **Local tick** — was missing before `useUrgencyLevel`; should work now (≤10s, tab focused) |
| “Border doesn’t appear after I save time” / “row doesn’t disappear after assign” | **React Query freshness** — async invalidation, no optimistic update |
| “Fahrten row borders don’t live-update” | **Pre-existing inconsistency** — not Pending Tours-specific |

### Polling, realtime, or hybrid?

**Hybrid — already the right shape:**

- **Local urgency ticking only** for border colors (keep `useUrgencyLevel`).
- **Realtime + mutation invalidation** for list membership and server fields (keep `useUnplannedTrips` as-is).
- **Do not add polling** for urgency.

### Exact smallest safe next step

1. **Verify** clock-based borders with DevTools: `useUrgencyLevel` should re-render the row every 10s without any network activity.
2. If the reported issue is **after saving** in the widget: **`await queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot })`** in `handleSetTime` (one-line behavioral fix).
3. Document 10s cadence and background-tab behavior in `docs/urgency-indicator.md` so “refresh” reports are not misdiagnosed.

No changes to urgency calculation windows, no `refetchInterval`, and no new helpers required for correct live borders.
