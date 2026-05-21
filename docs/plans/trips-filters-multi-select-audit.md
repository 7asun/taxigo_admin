# Trips filters multi-select & KTS options — audit

Read-only audit for planned changes to `trips-filters-bar.tsx`: multi-select Kostenträger (`payer_id`), multi-select Abrechnung (`billing_variant_id`), and two new KTS filter values (`no_kts`, `no_reha`).

**Files reviewed:** `trips-filters-bar.tsx`, `trips-listing.tsx`, `use-trip-form-data.ts`, `use-trip-reference-queries.ts`, `trip-reference-data.ts`, `reference.ts`, `searchparams.ts`, `docs/kts-architecture.md`, plus cross-repo patterns (`unzugeordnete-fahrten`, `use-data-table.ts`, invoice builder pickers).

---

## Block A — URL param strategy for multi-select

### 1. How does `trips-listing.tsx` read `payer_id` and `billing_variant_id`?

**Server (RSC):** `trips-listing.tsx` does **not** use `searchParams.get(...)`. It uses **`searchParamsCache`** from `nuqs/server`, populated via `await searchParamsCache.parse(searchParams)`:

```55:56:src/features/trips/components/trips-listing.tsx
  const payerId = searchParamsCache.get('payer_id');
  const billingVariantId = searchParamsCache.get('billing_variant_id');
```

Parsers are defined in `src/lib/searchparams.ts` as **`parseAsString`** (single string or `null` when absent):

```17:19:src/lib/searchparams.ts
  driver_id: parseAsString,
  payer_id: parseAsString,
  billing_variant_id: parseAsString,
```

**Client (filter bar):** `trips-filters-bar.tsx` uses **`useSearchParams()` from `next/navigation`**, not `nuqs` hooks:

```78:79:src/features/trips/components/trips-filters-bar.tsx
  const payerId = searchParams.get('payer_id') ?? 'all';
  const billingVariantId = searchParams.get('billing_variant_id') ?? 'all';
```

Neither side uses `searchParams.getAll(...)`. With `parseAsString`, **`nuqs` exposes at most one value per key** even if the URL contained repeated keys.

**Supabase application (listing):** single equality only:

```130:135:src/features/trips/components/trips-listing.tsx
    if (payerId && payerId !== 'all') {
      query = query.eq('payer_id', payerId);
    }
    if (billingVariantId && billingVariantId !== 'all') {
      query = query.eq('billing_variant_id', billingVariantId);
    }
```

Sentinel `'all'` is a **client-side default** when the param is missing (`?? 'all'` in the filter bar). The server treats “no filter” as **falsy / absent** param (`payerId && payerId !== 'all'`), not as the literal string `'all'` in the URL (reset writes `null` → key deleted).

---

### 2. Safest URL encoding strategy for multi-value filters

**Existing patterns in this codebase:**

| Location | Param | Encoding |
| -------- | ----- | -------- |
| `trips-listing.tsx` | `status` | **Comma-separated** in one param: if `status.includes(',')` → `.in('status', status.split(','))` |
| `trips-filters-bar.tsx` | `scheduled_at` | Comma-separated range `from,to` (timestamps) |
| `unzugeordnete-fahrten` | `payer_ids` | **Comma-separated** UUIDs: `params.set('payer_ids', payers.join(','))`, server `split(',')` |
| `use-data-table.ts` | column filters | **`nuqs` `parseAsArrayOf(parseAsString, ',')`** — comma separator constant `ARRAY_SEPARATOR = ','` |
| Trips `payer_id` / `billing_variant_id` | — | **No multi-value yet** |

**Repeated params** (`payer_id=a&payer_id=b`): **not used** anywhere in the trips flow. `updateFilters` only uses `params.set` / `params.delete`, never `append`. `parseAsString` on the server would not aggregate repeated keys into an array.

**Recommendation for trips multi-select:** **Comma-separated single param** (e.g. `payer_id=uuid1,uuid2`), aligned with `status`, `payer_ids` (unassigned trips), and TanStack table `parseAsArrayOf` defaults. Optionally upgrade `searchparams.ts` to `parseAsArrayOf(parseAsString, ',')` for typed `string[] | null` on the server; otherwise keep `parseAsString` and **split in `trips-listing`** (same as `status` today).

**Caveat:** UUIDs contain hyphens, not commas — safe for comma joining. Document that UUIDs must not be double-encoded.

---

### 3. Does `updateFilters()` use `set` or `append`? Multi-value writes?

```224:233:src/features/trips/components/trips-filters-bar.tsx
  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
```

- **`params.set(key, value)`** — replaces any existing value(s) for that key (does not accumulate).
- **`params.delete(key)`** — removes **all** entries for that key (correct for clearing repeated keys if they ever existed).

**For multi-select:** extend the contract so a non-null value is a **single comma-joined string** passed to `set` (e.g. `updateFilters({ payer_id: ids.join(',') })`). No `append` loop required.

Alternative: add a dedicated helper `updateMultiFilter(key, ids: string[] | null)` that joins or deletes — still built on `set`/`delete`.

**Type limitation:** `Record<string, string | null>` cannot pass arrays today; either join in the caller or widen the helper signature.

---

## Block B — Billing variants with multiple payers

### 4. `useTripFormData` and billing variants behaviour with multiple payer IDs

**Hook signature:** single optional payer only:

```40:43:src/features/trips/hooks/use-trip-form-data.ts
export function useTripFormData(payerId?: string | null) {
  const payersQuery = usePayersQuery();
  const driversQuery = useDriversQuery();
  const billingVariantsQuery = useBillingVariantsForPayerQuery(payerId);
```

**Concrete payer check** (URL sentinel `'all'` must not hit Supabase):

```50:55:src/features/trips/hooks/use-trip-form-data.ts
  const payerIsConcrete =
    typeof payerId === 'string' && payerId.length > 0 && payerId !== 'all';
  const isLoading =
    payersQuery.isPending ||
    driversQuery.isPending ||
    (payerIsConcrete && billingVariantsQuery.isPending);
```

**Query hook:** one payer ID; disabled unless “real” payer:

```40:51:src/features/trips/hooks/use-trip-reference-queries.ts
export function useBillingVariantsForPayerQuery(
  payerId: string | null | undefined
) {
  const isRealPayer =
    typeof payerId === 'string' && payerId.length > 0 && payerId !== 'all';

  return useQuery({
    queryKey: referenceKeys.billingVariants(isRealPayer ? payerId : '__none__'),
    queryFn: () => fetchBillingVariantsForPayer(payerId!),
    enabled: isRealPayer,
```

**Supabase fetcher:** **`.eq('payer_id', payerId)`** on `billing_types`, not `.in`:

```45:69:src/features/trips/api/trip-reference-data.ts
export async function fetchBillingVariantsForPayer(
  payerId: string
): Promise<BillingVariantOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('billing_types')
    .select(`... billing_variants (...)`)
    .eq('payer_id', payerId)
    .order('name');
```

**Filter bar UI today:** Abrechnung `<Select>` only when **exactly one** payer is selected:

```439:439:src/features/trips/components/trips-filters-bar.tsx
      {payerId !== 'all' && billingVariants.length > 0 && (
```

Changing payer clears billing variant:

```417:421:src/features/trips/components/trips-filters-bar.tsx
          if (val === 'all') {
            updateFilters({ payer_id: null, billing_variant_id: null });
          } else {
            updateFilters({ payer_id: val, billing_variant_id: null });
```

**Option A (union of variants for all selected payers):** requires new client fetch (e.g. `.in('payer_id', ids)` on `billing_types` or N parallel `fetchBillingVariantsForPayer` + merge/dedupe), new TanStack key shape (today `referenceKeys.billingVariants(payerId)` is **per single payer**), and UI that disambiguates variant labels (same code across payers).

**Option B (disable Abrechnung when >1 payer):** matches current architecture with minimal risk — hide/disable billing filter when `payerIds.length !== 1`, clear `billing_variant_id` on URL when entering multi-payer mode (same as payer change today).

**Audit note:** Passing a comma-joined string into `useTripFormData('uuid1,uuid2')` would **fail** `payerIsConcrete` logic only if the string contains a comma — actually `payerId !== 'all'` would be true for `'uuid1,uuid2'`, enabling the query with an **invalid** `.eq('payer_id', 'uuid1,uuid2')`. Multi-payer **must not** pass a joined string into the existing hook without changes.

---

### 5. Existing RPC/query for billing variants across multiple payers?

**Trips reference layer:** **No** — only `fetchBillingVariantsForPayer(payerId: string)` with `.eq`.

**Elsewhere:**

- `unzugeordnete-fahrten` loads variants **per payer group** after grouping trips (`.eq('billing_types.payer_id', group.payerId)`), not a union API for filters.
- Invoice builder (`invoice-line-items.api.ts`) has multi-variant trip fetch branches (`billing_variant_ids`, `.in('billing_variant_id', ...)`) for **invoice line items**, not for the Fahrten filter reference dropdown.

**Conclusion:** A **new query variant** (or generalization of `fetchBillingVariantsForPayer` to `fetchBillingVariantsForPayers(ids: string[])`) is needed for Option A. No drop-in RPC found in trips code paths.

---

## Block C — Server-side KTS filter

### 6. Exact `kts_filter` sentinel values and handling

**Filter bar** — allowlist + default `'all'`:

```83:89:src/features/trips/components/trips-filters-bar.tsx
  const ktsFilterRaw = searchParams.get('kts_filter') ?? 'all';
  const ktsFilter =
    ktsFilterRaw === 'kts' ||
    ktsFilterRaw === 'kts_fehler' ||
    ktsFilterRaw === 'all'
      ? ktsFilterRaw
      : 'all';
```

**UI options:** `all`, `kts`, `kts_fehler` (writes `null` to URL for `all`).

**Server (`trips-listing.tsx`):** **`if / else if`** on PostgREST query builder — **not** an RPC:

```60:60:src/features/trips/components/trips-listing.tsx
  const ktsFilter = searchParamsCache.get('kts_filter') ?? 'all';
```

```136:143:src/features/trips/components/trips-listing.tsx
    // KTS filter — narrows trips by KTS document state.
    // 'kts_fehler' implies kts_document_applies so both conditions are applied.
    // 'all' (default) applies no condition.
    if (ktsFilter === 'kts') {
      query = query.eq('kts_document_applies', true);
    } else if (ktsFilter === 'kts_fehler') {
      query = query.eq('kts_document_applies', true).eq('kts_fehler', true);
    }
```

**Confirmed active values:** `'all'` (no SQL filter), `'kts'`, `'kts_fehler'`. Unknown values from URL are **not** re-validated on the server — a crafted `kts_filter=foo` would apply **no** KTS condition (same as `all`).

**`nuqs` comment** in `searchparams.ts`:

```22:23:src/lib/searchparams.ts
  /** KTS list filter: `kts` | `kts_fehler`; absent = all trips. */
  kts_filter: parseAsString,
```

**Kanban remount key** intentionally **omits** `kts_filter` (see `.cursor/plans/kts_filter_dropdown_944b7343.plan.md`).

---

### 7. Data model for new filters `no_kts` and `no_reha`

From `docs/kts-architecture.md` and `database.types.ts` / listing embed:

| Planned value | Meaning (product) | Column(s) on `trips` | Suggested PostgREST condition |
| ------------- | ----------------- | -------------------- | ------------------------------ |
| `no_kts` | No KTS on trip | `kts_document_applies` (`boolean NOT NULL`) | `.eq('kts_document_applies', false)` |
| `no_reha` | No Reha-Schein | `reha_schein` (`boolean NOT NULL`) | `.eq('reha_schein', false)` |

**Not** a separate document attachment table in the list query — operational flags on `trips`. `kts_fehler` is independent; `no_kts` is the inverse of the existing `kts` branch, not “missing file blob.”

**Reha:** separate from KTS; gate on payer is `payers.reha_schein_enabled` for UI, but list filter on **`trips.reha_schein`** is consistent with “trip has no Reha-Schein set.”

**Implementation in `trips-listing.tsx`:** extend the same `if / else if` chain (no migration required for read path if columns already exist).

**Cannot determine from client alone:** whether product wants `no_kts` to exclude trips where KTS applies but only `kts_fehler` is set — today `kts` requires `kts_document_applies = true`; `no_kts` as `false` includes error-flagged non-KTS trips. Confirm with product; no extra server file required beyond listing unless semantics need `(kts_document_applies.eq.false)` OR complex OR.

---

### 8. TypeScript type / enum for `kts_filter`?

**No shared enum or union type** found. Values are **string literals** in:

- `trips-filters-bar.tsx` (allowlist),
- `trips-listing.tsx` (branches),
- `searchparams.ts` (comment only).

**Should extend:** add e.g. `TripsKtsFilter` in `src/features/trips/...` and use in filter bar + listing + `searchparams` comment; optional Zod if URL validation is desired. Not strictly required for v1 if literals stay in sync.

---

## Block D — Component architecture

### 9. Existing Popover + Command multi-select pattern?

**In `trips-filters-bar.tsx`:** `Command` is used for **column visibility** (toggle, not multi-select entity IDs).

**Reusable multi-select (checkbox rows):**

1. **`src/components/ui/table/data-table-faceted-filter.tsx`** — Popover + Command + checkbox squares; tied to TanStack `column` API.
2. **`src/features/invoices/components/invoice-builder/step-2-params.tsx`** — **`MonthlyBillingTypesPicker`** and **`MonthlyVariantSubsetPicker`** — same visual pattern, **RHF-driven**, best template for form/filter multi-select without a table column.

**Recommendation for Fahrten filters:** Copy/adapt **`MonthlyVariantSubsetPicker`** / faceted filter markup from `step-2-params.tsx` or extract a small shared `MultiSelectCommandPopover` — not Radix `<Select>`.

---

### 10. `hasAdvancedFilters` — current condition and multi-select changes

**Current:**

```140:149:src/features/trips/components/trips-filters-bar.tsx
  const hasAdvancedFilters = useMemo((): boolean => {
    return (
      driverId !== 'all' ||
      status !== 'all' ||
      payerId !== 'all' ||
      (Boolean(billingVariantId) && billingVariantId !== 'all') ||
      invoiceStatus !== 'all' ||
      ktsFilter !== 'all'
    );
  }, [driverId, status, payerId, billingVariantId, invoiceStatus, ktsFilter]);
```

**Multi-select migration:**

- Replace `payerId !== 'all'` with e.g. **`selectedPayerIds.length > 0`** (parsed from comma-separated URL or empty = no filter).
- Replace billing check with **`selectedBillingVariantIds.length > 0`** (or keep hidden when multiple payers).
- Add **`ktsFilter !== 'all'`** already covers new KTS values once allowlist includes `no_kts` / `no_reha`.
- Stop using sentinel `'all'` for payer/billing in component state; **absent param = no filter** is the server contract.

---

### 11. Reset button and clearing multi-value params

Reset payload:

```488:497:src/features/trips/components/trips-filters-bar.tsx
          updateFilters({
            search: null,
            driver_id: null,
            status: null,
            payer_id: null,
            scheduled_at: null,
            billing_variant_id: null,
            invoice_status: null,
            kts_filter: null
          });
```

**`null` → `params.delete(key)`** removes the entire key, including all repeated values if any existed.

**Sufficient for comma-separated multi-select:** yes — one key, one `delete`.

**Not sufficient if:** implementation mistakenly used multiple keys without deleting each — not the case today.

After multi-select, ensure UI local state (parsed ID arrays) resets when URL clears (mirror `useEffect` on `search` for payer/billing arrays).

---

## Senior recommendation — lowest-risk implementation order

1. **KTS options (`no_kts`, `no_reha`) first**
   - Touch only: `trips-filters-bar.tsx` (allowlist + `<SelectItem>`), `trips-listing.tsx` (two `else if` branches), `searchparams.ts` comment, optional shared type.
   - No reference queries, no URL multi-value contract, no billing/payer coupling.
   - Add server allowlist or treat unknown like `all` if parity with client matters.

2. **Multi-select Kostenträger (`payer_id`) second**
   - Define comma-separated URL contract; update `searchparams` + `trips-listing` `.in('payer_id', ids)` after split.
   - Replace payer `<Select>` with Popover+Command multi-select (pattern from `step-2-params.tsx`).
   - **Adopt Option B for Abrechnung:** when more than one payer selected, **hide** billing filter and **`billing_variant_id: null`** on payer change (extend current “clear billing on payer change” behaviour).
   - Do **not** pass joined payer string into `useTripFormData` until a multi-payer fetch exists.

3. **Multi-select Abrechnung (`billing_variant_id`) last**
   - Depends on stable multi-payer UX: only enable when **exactly one** payer **or** after implementing **union fetch** (new `fetchBillingVariantsForPayers` + cache keys).
   - Server: `.in('billing_variant_id', ids)` mirroring payer split.
   - Highest coupling: variant labels, duplicate codes across payers, `referenceKeys.billingVariants`, CSV export dialog (`csv-export-dialog.tsx` still single `payerId`), kanban key (consider adding `kts_filter` / multi payer strings for remount consistency).

**Cross-cutting (do early, small):** align `trips-filters-bar` reads with server parsing (parse comma lists once); extend `updateFilters` or add join helper; update `docs/trips-filters-bar.md` (still documents `billing_type_id` in places — stale).

**Defer:** `kanbanKey` updates for `kts_filter` and multi filters unless Kanban stale-state bugs reappear; prior plan explicitly deferred `kts_filter` in `kanbanKey`.
