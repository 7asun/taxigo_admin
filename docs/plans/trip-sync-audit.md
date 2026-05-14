# Audit — Trip detail sheet cache sync after inline cell mutation

Read-only audit (2026-05-14). Scope: how React Query invalidation after grid inline edits relates to the trip detail sheet data source and KTS/Reha draft state.

---

## 1. Detail sheet data source

### Does the detail sheet fetch its own trip data via `useQuery`?

**Yes.** The sheet calls `useTripQuery(tripId)`; there is no `trip` object passed in as a prop.

- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` **L227–L233**: props are `tripId`, `isOpen`, `onOpenChange`, optional `onNavigateToTrip` — **no trip row prop**.
- **L241**: `const { trip, isLoading: isTripLoading } = useTripQuery(tripId);`

### Exact query key (when `tripId` is non-null)

Defined in `src/query/keys/trips.ts` **L12–L13**:

```ts
detail: (tripId: string) => ['trips', 'detail', tripId] as const,
```

Used in `src/features/trips/hooks/use-trips.ts` **L94–L96**:

```ts
queryKey: id ? tripKeys.detail(id) : TRIP_DETAIL_DISABLED_KEY,
queryFn: () => tripsService.getTripById(id!),
enabled: !!id,
```

So the detail cache key is **`['trips', 'detail', <tripId>]`** (i.e. `tripKeys.detail(id)`).

### Prop chain from the table (row → sheet)

The Fahrten table row does **not** pass embedded trip data into the sheet.

- `src/features/trips/components/trips-tables/cell-action.tsx` **L50–L56**: local state `detailTripId` initialized to `data.id`; effect keeps `detailTripId` in sync with `data.id` while the detail sheet is open.
- **L149–L154**: `TripDetailSheet` receives `tripId={detailTripId}` only (plus `isOpen` / `onOpenChange` / `onNavigateToTrip`).
- `src/features/overview/components/trip-detail-sheet.tsx` **L1–L2**: re-exports `TripDetailSheet` from `@/features/trips/trip-detail-sheet` — same implementation as above.

The “live” trip in the sheet is **`trip` from `useTripQuery`**, i.e. `getTripById` results in the TanStack Query cache, not the RSC table row object.

### Separate detail query vs “list” query

- **Detail:** `tripKeys.detail(tripId)` — **L13** in `src/query/keys/trips.ts`; used by `useTripQuery` (**use-trips.ts** **L94–L96**).
- **Broad trips key:** `tripKeys.all` → `['trips']` — **L9–L10** in `trips.ts`; used by `useTrips()` (**use-trips.ts** **L25–L27**) for dashboard-style `getTrips()` fetching.
- There is **no** `tripKeys.list` (or similar) for the paginated **Fahrten** RSC table in `trips.ts`. That list is server-rendered in `trips-listing.tsx`, not a React Query `useQuery` with its own key in this module.

---

## 2. What `useUpdateTripMutation` invalidates today

**File:** `src/features/trips/hooks/use-update-trip-mutation.ts` **L20–L25** (`onSuccess`):

```ts
void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
void queryClient.invalidateQueries({ queryKey: tripKeys.all });
```

- **Yes**, it invalidates **`tripKeys.detail(id)`** — **L22**.
- It also invalidates **`tripKeys.all`** (`['trips']`) — **L24** — which targets queries whose keys are under that root (e.g. **`useTrips`** in **use-trips.ts** **L25–L27**). It does **not** by itself refetch the Next.js RSC payload for `/dashboard/trips`; that path typically relies on **`router.refresh` / `TripsRscRefresh`** patterns outside this mutation.

---

## 3. `useTripFieldUpdate` invalidation

**File:** `src/features/trips/hooks/use-trip-field-update.ts` — full file **L1–L28**.

- **No additional invalidation.** It only wraps `useUpdateTripMutation`’s `mutate` (**L14**, **L22**).
- **`KtsSwitchCell` ON path** (`src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` **L35**): `updateField(...)` → same `mutate` → same `onSuccess` → invalidates **`tripKeys.detail(id)`** and **`tripKeys.all`** (per **use-update-trip-mutation.ts** **L22–L24**).
- **`KtsSwitchCell` OFF path** (**L39–L46**): calls `mutate` directly with multi-field patch → **same** invalidations.

---

## 4. How the detail sheet opens — refetch vs table row

### Does the sheet use table row data?

**No** for the main `trip` object: content is driven by **`useTripQuery(tripId)`** (**trip-detail-sheet.tsx** **L241**).

### Re-fetch when opening?

- **`TripDetailSheet` does not call `refetch` on `isOpen` / `onOpenChange`.** A repo-wide grep for `refetch` in `trip-detail-sheet.tsx` only hits a comment at **L1966** (“Realtime … will refetch”), not an explicit `useEffect(..., [isOpen])` refetch.
- **`useTripQuery`** returns `refetch` (**use-trips.ts** **L145**) but the sheet destructures only `{ trip, isLoading }` (**trip-detail-sheet.tsx** **L241**) — **no `refetch` usage** on open.
- **Query behavior:** `useTripQuery` is **`enabled: !!id`** (**use-trips.ts** **L97**), not gated on `isOpen`. With **`staleTime: 90_000`** (**L99**), opening the sheet usually shows **cached** detail data until a refetch is triggered (invalidation, window focus, etc.) or the cache is stale.

### Supabase realtime on the detail row

**use-trips.ts** **L102–L131**: while `id` is set, a realtime subscription schedules debounced invalidation for that trip’s detail (via `createDebouncedTripDetailInvalidation`), which can refetch the detail query **independently** of the sheet open state.

---

## 5. KTS / Reha draft state in the detail sheet

### Held in local `useState`?

**Yes.**

- `kts_document_applies` → `ktsDocumentAppliesDraft` — **trip-detail-sheet.tsx** **L269**
- `reha_schein` → `rehaScheinDraft` — **L270**
- `kts_fehler` → `ktsFehlerDraft` — **L271**
- `kts_fehler_beschreibung` → `ktsFehlerBeschreibungDraft` — **L272–L273**

### When drafts are initialized from server `trip`

Primary bulk hydrate effect — **L482–L537**, with dependency array **`[trip?.id]`** only (**L537**).

Inside that effect, when `trip` is defined:

- **L516:** `setKtsDocumentAppliesDraft(!!trip.kts_document_applies);`
- **L518:** `setRehaScheinDraft(!!trip.reha_schein);`
- **L519:** `setKtsFehlerDraft(!!trip.kts_fehler);`
- **L520:** `setKtsFehlerBeschreibungDraft(trip.kts_fehler_beschreibung ?? '');`

**Implication for cache sync:** when `trip.id` is unchanged, **updates** to `trip.kts_*` / `trip.reha_schein` on the **same** query result (e.g. after `tripKeys.detail(id)` refetch following an inline cell save) **do not** re-run this effect. Drafts are **not** automatically re-synced from the refreshed `trip` object on every server update — only when **`trip.id` changes** (or other code paths below mutate drafts).

### Other draft touchpoints (non-exhaustive)

- **KTS catalog when billing changes:** **L342–L377** can call `setKtsDocumentAppliesDraft` when `billingChangedFromTrip` and payer/variant are set (deps **L371–L377**).
- **Reha when Kostenträger changes:** payer `Select` **L1566–L1572** adjusts `setRehaScheinDraft` from payer row / `trip.reha_schein`.
- **In-sheet controls:** e.g. KTS `Switch` **L1694+**, Reha **L1721** (`onCheckedChange={setRehaScheinDraft}`), KTS-Fehler `Checkbox` / `Textarea` **L1663–L1683**.

---

## Summary table (inline mutation → cache → sheet)

| Step | What happens |
|------|----------------|
| Inline cell save | `useUpdateTripMutation` / `useTripFieldUpdate` → `onSuccess` invalidates **`tripKeys.detail(id)`** and **`tripKeys.all`** (**use-update-trip-mutation.ts** **L22–L24**). |
| Detail query | `useTripQuery` refetches; `trip` updates in memory. |
| Sheet drafts | Main hydrate effect depends on **`trip?.id` only** (**trip-detail-sheet.tsx** **L537**); same-id refetch **does not** reset KTS/Reha drafts from the new `trip` fields. |
| Fahrten table (RSC) | Not driven by `tripKeys`; depends on separate refresh/navigation behavior, not covered by this mutation’s keys alone. |
