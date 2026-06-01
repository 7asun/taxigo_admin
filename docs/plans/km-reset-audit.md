# Audit — KM override reset in invoice builder

**Scope:** Invoice builder create flow (`/dashboard/invoices/new`), KM override editing in Step 3, and hypotheses about map navigation vs background refetch/session expiry.

**Files read:**

| File | Notes |
|------|--------|
| `src/features/invoices/hooks/use-invoice-builder.ts` | Full — trips query, `lineItems`, `applyKmOverride` |
| `src/features/invoices/hooks/use-invoice-builder-trips.ts` | **Does not exist** — trips logic lives in `use-invoice-builder.ts` |
| `src/features/invoices/components/invoice-builder/index.tsx` | Full — shell wiring |
| `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | Full — KM input + map icon (no `trip-row.tsx`) |
| `src/app/dashboard/invoices/new/page.tsx` | Full — server page, passes reference data |
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Full — PDF preview hook (under `components/`, not `hooks/`) |
| `src/query/query-client.ts` | Global React Query defaults |
| `src/lib/supabase/client.ts` | Browser Supabase client |
| `src/components/layout/user-nav.tsx` | `onAuthStateChange` |
| Grep in `src/features/invoices/components/invoice-builder/` | No `window.open`, no `localStorage`/`sessionStorage`/`beforeunload` |

---

## Hypothesis 1 — Map icon navigation causes state loss

### 1. What happens when the map icon is clicked?

The map icon is an `<a>` tag with `target="_blank"`. It does **not** call `window.open()`, `window.location`, or same-tab navigation.

**File:** `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```574:583:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                                  <a
                                    href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(item.pickup_address)}&destination=${encodeURIComponent(item.dropoff_address)}`}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    aria-label='Route in Google Maps öffnen'
                                    className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors'
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Map className='h-3.5 w-3.5' />
                                  </a>
```

Grep across the invoice-builder folder found **no** `window.open`, `openstreetmap`, or same-tab map navigation. The only `window.open` under `src/features/invoices/` is in `invoice-list-table/index.tsx` (unrelated).

### 2. Would this cause the builder to unmount?

**No, not directly.** `target="_blank"` opens Google Maps in a new browsing context. The invoice builder tab stays mounted; React state in that tab is preserved.

Same-tab navigation (`window.location`, `<a>` without `target="_blank"`, or `router.push` away from the builder) would unmount the builder and destroy all in-memory state. That pattern is **not** used for the map icon.

**Indirect link to Hypothesis 2:** Clicking the map often means the admin switches to the Maps tab and later returns to the builder tab. That **tab switch + return** can trigger React Query’s `refetchOnWindowFocus` (see §5–7), which *does* reset KM overrides in create mode — but the mechanism is refetch, not map navigation itself.

### 3. Persistence that would survive page navigation?

| Mechanism | Present? | Covers KM overrides? |
|-----------|----------|----------------------|
| `localStorage` / `sessionStorage` | **No** in invoice builder | — |
| URL search params | **No** for builder edits | — |
| `beforeunload` guard | **No** (kanban has one; builder does not) | — |
| React Query cache | Yes — stores **trip fetch result**, not builder overrides | **No** — overrides live only in `lineItems` React state until invoice save |
| DB (`trips.manual_distance_km`) | Written only on **invoice create/update** (fire-and-forget) | Only **committed** overrides after save; not in-progress session edits |

Edit-mode hydration query is pinned (`staleTime: Infinity`, `refetchOnWindowFocus: false`) and seeds once via `hasHydratedRef` — but that protects **loaded draft line items**, not create-mode trip refetch.

---

## Hypothesis 2 — Silent session expiry / data refresh wipes state

### 4. Supabase auth session timeout

**File:** `src/lib/supabase/client.ts`

```21:29:src/lib/supabase/client.ts
export function createClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const { url, anonKey } = getSupabaseEnv();
  client = createBrowserClient(url, anonKey);

  return client;
}
```

No custom `auth` options, `persistSession`, or JWT expiry overrides in app code. The browser client uses Supabase SSR defaults: access tokens refresh automatically via refresh token; there is **no project-specific session timeout** configured in this repo.

Session expiry would only affect builder state if it caused a **full redirect** (e.g. middleware sending unauthenticated users to `/auth/sign-in`). `src/proxy.ts` validates auth on dashboard routes but does not subscribe to token refresh in the client builder.

### 5. Does the builder use React Query for trips? staleTime / gcTime?

**Yes** — `tripsQuery` in `use-invoice-builder.ts` (create mode only; disabled in edit mode).

```266:339:src/features/invoices/hooks/use-invoice-builder.ts
  const tripsQuery = useQuery({
    queryKey: step2Values
      ? invoiceKeys.tripsForBuilder(tripsBuilderParamsFromStep2(step2Values))
      : ['invoices', 'builder-trips', 'idle'],
    queryFn: async () => {
      // ... fetch rules + trips ...
      const items = buildLineItemsFromTrips(
        trips,
        rules,
        clientPriceTags,
        clientKmOverrides
      );
      // ...
      setLineItems(items);
      // ...
      return items;
    },
    enabled: !isEditMode && step2ValuesReadyForTripsFetch(step2Values),
    staleTime: 5 * 60 * 1000
  });
```

| Setting | `tripsQuery` value | Global default (`query-client.ts`) |
|---------|-------------------|-----------------------------------|
| `staleTime` | **`5 * 60 * 1000` (5 minutes)** | `60_000` (1 minute) |
| `gcTime` | **Not set** → TanStack Query v5 default **`300_000` ms (5 minutes)** | Not set on `QueryClient` |
| `refetchOnWindowFocus` | **Not set** → inherits **`true`** | **`true`** |

After 5 minutes, trip data is **stale**. Window focus, reconnect, or other stale-triggered refetch will re-run `queryFn`, which calls `setLineItems(buildLineItemsFromTrips(...))` and rebuilds from server trip rows.

`buildLineItemsFromTrips` reads `trip.manual_distance_km` from the DB but does **not** set builder-only fields `manualDistanceKm` / `isManualKmOverride` (those are applied later via `applyKmOverride`). In-session overrides that were never saved to `trips` are **lost on refetch**.

### 6. useEffect / subscription that resets local state when trips data changes?

**No separate `useEffect` watching `tripsQuery.data`.** Reset happens **inside `queryFn`** via `setLineItems(items)` whenever the query runs (initial fetch + any refetch).

Additional reset path (create mode only):

```160:170:src/features/invoices/hooks/use-invoice-builder.ts
  useEffect(() => {
    if (isEditMode) return;
    if (!step2ValuesReadyForTripsFetch(step2Values)) {
      setLineItems([]);
      setCancelledTrips([]);
      setCatalogRecipientId(null);
      setSection3Confirmed(false);
    }
  }, [step2Values, isEditMode]);
```

This clears `lineItems` when Step 2 params become incomplete — not typical during Step 3 editing, but would wipe KM overrides if Step 2 values were cleared or invalidated.

Edit mode explicitly avoids trip refetch:

```334:337:src/features/invoices/hooks/use-invoice-builder.ts
    // why: in edit mode we hydrate from the persisted draft and must NOT fetch
    // trips — re-running buildLineItemsFromTrips would silently recompute prices
    // from current (mutable) trips on load.
    enabled: !isEditMode && step2ValuesReadyForTripsFetch(step2Values),
```

Edit hydration is guarded by `hasHydratedRef` (seed once; never overwrite on refetch) — **create mode has no equivalent guard for `tripsQuery` refetch**.

### 7. Window focus listener?

**No custom** `visibilitychange`, `focus`, or `onfocus` handlers in the builder hook or Step 3 component.

The only `window.addEventListener` in `step-3-line-items.tsx` is **`resize`** for scroll-fade UI (lines 257–260), unrelated to data refetch.

Refetch on focus comes from **global React Query default**:

```19:28:src/query/query-client.ts
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: 1,
        refetchOnWindowFocus: true
      }
    }
  });
}
```

**Timeline:** Admin completes Step 2 → trips load → edits KM → waits **≥ 5 minutes** (or loses network and reconnects) → returns to builder tab → `refetchOnWindowFocus` fires → `queryFn` runs → `setLineItems` overwrites overrides.

### 8. Session refresh side effect (`onAuthStateChange`)?

**File:** `src/components/layout/user-nav.tsx`

```29:33:src/components/layout/user-nav.tsx
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
```

This only updates the nav user avatar/state. It does **not** navigate, invalidate invoice queries, or remount the builder. Sign-out explicitly calls `router.push('/auth/sign-in')` — that would destroy builder state, but token refresh events do not.

---

## General

### 9. Where are KM override values stored during editing?

**Two layers:**

#### A. Committed overrides (affect pricing / PDF)

**Top-level hook state** — `lineItems: BuilderLineItem[]` in `useInvoiceBuilder`:

```127:128:src/features/invoices/hooks/use-invoice-builder.ts
  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);
```

Committed via `applyKmOverride`:

```397:412:src/features/invoices/hooks/use-invoice-builder.ts
  const applyKmOverride = useCallback((position: number, km: number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.position !== position) return item;
        if (!Number.isFinite(km) || km <= 0) return item;
        // ...
        const patched: BuilderLineItem = {
          ...item,
          effective_distance_km: km,
          manualDistanceKm: km,
          isManualKmOverride: true,
```

Not React Query cache, not a form library (React Hook Form is used for Step 2/4/5 meta, not per-row KM).

#### B. In-progress typing (before blur / Enter)

**Child component local state** in `Step3LineItems`:

```223:244:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
  const [kmEditing, setKmEditing] = useState<KmEditingState>(null);
  // ...
  const kmEditingRef = useRef<KmEditingState>(null);
```

Committed to parent on blur/Enter via `commitKmEdit` → `onApplyKmOverride` (wired to `applyKmOverride` in `index.tsx`).

Persisted to DB only when invoice is saved:

```858:860:src/features/invoices/hooks/use-invoice-builder.ts
              ...(item.isManualKmOverride && item.manualDistanceKm != null
                ? { manual_distance_km: item.manualDistanceKm }
                : {})
```

### 10. Mechanism that resets KM on parent re-mount or route change?

**No KM-specific reset handler.** Any full unmount (route leave, hard reload, tab crash, auth redirect) destroys:

- `lineItems` (including committed `manualDistanceKm` / `isManualKmOverride`)
- `kmEditing` / `kmEditingRef` (uncommitted input)

In **create mode**, staying on the same route but triggering **`tripsQuery` refetch** effectively resets committed KM overrides by rebuilding `lineItems` from trips — functionally equivalent to remount for KM purposes, without leaving the page.

In **edit mode**, `tripsQuery` is disabled and hydration is one-shot — committed KM from the draft survives focus/refetch unless the whole page reloads.

### 11. Senior assessment

| Hypothesis | Verdict |
|------------|---------|
| **H1 — Map icon navigation** | **Unlikely as root cause.** Implementation is correct (`<a target="_blank">`). Map click does not unmount the builder. |
| **H2 — Refetch / refresh wipes state** | **Very likely in create mode.** 5-minute `staleTime` + global `refetchOnWindowFocus: true` + `setLineItems` inside `queryFn` = silent overwrite of in-session KM overrides. |

**Single most likely trigger for KM loss after 5–10 minutes:**

> Admin is on **`/dashboard/invoices/new`** (create mode), has applied KM overrides in Step 3, then switches away (often to Google Maps opened from the row, or another app/tab) for **≥ 5 minutes**. On return, React Query refetches stale trips and **`setLineItems(buildLineItemsFromTrips(...))`** rebuilds rows from DB trips that still lack unsaved `manual_distance_km`, wiping builder-only overrides.

This matches the reported **time window** (5 min staleTime) better than map navigation or auth session expiry.

**Secondary contributors:**

1. **Uncommitted KM** in `kmEditing` — lost on any remount/refetch display refresh even if user typed but did not blur.
2. **Full page reload / tab crash** (e.g. PDF preview memory pressure) — loses all state; timing correlates with edit activity, not necessarily 5 min.
3. **Edit mode** is largely protected from trip refetch; if reports come from **draft re-open** (`/edit`), investigate full reload or uncommitted `kmEditing` instead.

**Not the primary cause:** Map same-tab navigation (not implemented), Supabase session timeout in client config (none custom), `onAuthStateChange` remount (nav only).

---

## Recommended fix directions (audit only — not implemented)

1. Set `refetchOnWindowFocus: false` (and optionally `refetchOnReconnect: false`) on `tripsQuery`, **or** stop calling `setLineItems` on refetch when line items already exist (merge/preserve overrides).
2. Mirror edit-mode **`hasHydratedRef`** pattern for create-mode trip seed — refetch should not clobber in-progress edits.
3. Optional UX: persist draft builder state to `sessionStorage` keyed by step2 params.
4. Commit KM on `change` with debounce, not only blur — reduces loss of uncommitted `kmEditing`.
