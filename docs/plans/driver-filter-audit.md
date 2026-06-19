# Driver Filter Mismatch — List vs Export (10 vs 11 rows)

**Repro context (confirmed):**

- URL: `driver_id=<UUID>` (plain UUID, not `all` / `fremdfirma:all`) + `scheduled_at=<today YMD>`
- `invoice_status`, `search`, `fremdfirma:all` **absent**
- Table: **10** trips; export preview: **11**

**Hypothesis under test:** driver filter is applied differently between list and export.

**Verdict:** When both sides apply the driver filter, the Supabase clauses are **identical** — a single `.eq('driver_id', uuid)` with **no** `fremdfirma_id`, **no** `trip_assignments`, **no** OR fallback. The driver hypothesis **does not explain** a +1 row by itself. The only remaining **query-string difference** in the audited code is the **date OR branch** for unscheduled trips (`requested_date.eq` vs `requested_date.gte/lte`). Also verify the preview request actually sends assignee params (if `assigneeFilter` is null on the client, export counts **all** drivers for today → export ≥ list).

---

## 1. Complete driver filter branch — `trips-listing.tsx`

### Param read

```60:60:src/features/trips/components/trips-listing.tsx
  const driverId = searchParamsCache.get('driver_id');
```

No `'all'` default — absent param → `null` → `parseAssigneeParam` → `{ kind: 'all' }` (no filter). With `driver_id=<UUID>` in URL → plain string UUID.

### Parse + switch (complete assignee branch)

```129:146:src/features/trips/components/trips-listing.tsx
    const assigneeFilter = parseAssigneeParam(driverId);
    switch (assigneeFilter.kind) {
      case 'unassigned':
        // Genuinely unassigned — Fremdfirma rows also have driver_id null.
        query = query.is('driver_id', null).is('fremdfirma_id', null);
        break;
      case 'fremdfirma_all':
        query = query.not('fremdfirma_id', 'is', null);
        break;
      case 'fremdfirma':
        query = query.eq('fremdfirma_id', assigneeFilter.id);
        break;
      case 'driver':
        query = query.eq('driver_id', assigneeFilter.id);
        break;
      case 'all':
        break;
    }
```

### For `driver_id=<UUID>` specifically

**Parser** (`trip-assignee.ts`):

```30:52:src/features/trips/lib/trip-assignee.ts
export function parseAssigneeParam(
  driverIdParam: string | null | undefined
): AssigneeFilterParam {
  if (!driverIdParam) {
    return { kind: 'all' };
  }

  if (driverIdParam === 'unassigned') {
    return { kind: 'unassigned' };
  }

  if (driverIdParam === FREMDFIRMA_ALL_VALUE) {
    return { kind: 'fremdfirma_all' };
  }

  if (driverIdParam.startsWith(FREMDFIRMA_PARAM_PREFIX)) {
    const id = driverIdParam.slice(FREMDFIRMA_PARAM_PREFIX.length);
    if (id) {
      return { kind: 'fremdfirma', id };
    }
  }

  return { kind: 'driver', id: driverIdParam };
}
```

**Result:** `{ kind: 'driver', id: '<UUID>' }` → **`case 'driver'`** runs.

| Question | Answer |
|----------|--------|
| Column(s) filtered? | **`driver_id` only** |
| Also `fremdfirma_id`? | **No** — not touched for `driver` case |
| Join table / assignment? | **No** — no `trip_assignments`, no `vehicle_id`, no `group_id` |
| Exact Supabase clause | **`query.eq('driver_id', assigneeFilter.id)`** |

**PostgREST shape (conceptual):** `driver_id=eq.<UUID>` AND-combined with all other filters.

**Important:** A row with **`fremdfirma_id` set and `driver_id=<UUID>`** (stale dual assignment — canonical writes should clear `driver_id` when Fremdfirma is set, see `buildAssignmentPatch`) **still matches** `.eq('driver_id', UUID)`. List does **not** exclude Fremdfirma rows when filtering by driver UUID.

---

## 2. Complete assignee branch — `applyExportFilters` (`export-query.ts`)

### Full function (assignee + date order)

```281:340:src/features/trips/lib/export-query.ts
export function applyExportFilters<T>(query: T, filters: ExportFilters): T {
  const q = query as unknown as ChainableQuery;
  const { startISO: fromISO } = getZonedDayBoundsIso(filters.dateFrom);
  const { endExclusiveISO: toISO } = getZonedDayBoundsIso(filters.dateTo);

  const dateBranches = [
    `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO})`,
    `and(scheduled_at.is.null,requested_date.gte.${filters.dateFrom},requested_date.lte.${filters.dateTo})`
  ];
  // WHY: mirrors the list view backlog branch so single-day table-view export includes the same undated trips the admin sees on screen.
  if (
    filters.dateFrom === filters.dateTo &&
    filters.dateFrom === todayYmdInBusinessTz()
  ) {
    dateBranches.push(`and(scheduled_at.is.null,requested_date.is.null)`);
  }
  let next = q.or(dateBranches.join(',')) as ChainableQuery;

  if (filters.payerIds.length > 0) {
    next = next.in('payer_id', filters.payerIds) as ChainableQuery;
  }

  if (filters.billingVariantIds.length > 0) {
    next = next.in(
      'billing_variant_id',
      filters.billingVariantIds
    ) as ChainableQuery;
  }

  if (filters.assigneeFilter) {
    switch (filters.assigneeFilter.type) {
      case 'unassigned':
        next = next
          .is('driver_id', null)
          .is('fremdfirma_id', null) as ChainableQuery;
        break;
      case 'driver':
        next = next.eq(
          'driver_id',
          filters.assigneeFilter.driverId
        ) as ChainableQuery;
        break;
      case 'fremdfirma':
        next = next.eq(
          'fremdfirma_id',
          filters.assigneeFilter.fremdfirmaId
        ) as ChainableQuery;
        break;
    }
  }

  if (filters.statusFilter.length === 1) {
    next = next.eq('status', filters.statusFilter[0]!) as ChainableQuery;
  } else if (filters.statusFilter.length > 1) {
    next = next.in('status', filters.statusFilter) as ChainableQuery;
  }

  next = applyKtsFilter(next, filters.ktsFilter);

  return next as unknown as T;
}
```

### For `assigneeFilter: { type: 'driver', driverId: '<UUID>' }`

| Question | Answer |
|----------|--------|
| Column(s) filtered? | **`driver_id` only** |
| Also `fremdfirma_id`? | **No** |
| Identical SQL to list? | **Yes** — same `.eq('driver_id', uuid)` |
| Exact Supabase clause | **`next.eq('driver_id', filters.assigneeFilter.driverId)`** |

**PostgREST shape (conceptual):**  
`(date_or_branches…) AND driver_id=eq.<UUID>`

**Filter order differs, semantics do not:** list applies **driver first, then date `.or()`**; export applies **date `.or()` first, then driver `.eq()`**. PostgREST AND-chains both — equivalent to:

```sql
driver_id = '<UUID>'
AND (
  (scheduled_at >= start AND scheduled_at < end_exclusive)
  OR (scheduled_at IS NULL AND requested_date …)
  OR (scheduled_at IS NULL AND requested_date IS NULL)  -- today only
)
```

### When `assigneeFilter` is null

If `filters.assigneeFilter` is **`null`**, the entire `if (filters.assigneeFilter)` block is skipped — **no driver filter at all**. Preview would count **all assignees** for the date scope. That yields **export count ≥ list count** when list has `driver_id=<UUID>` — the most plausible non-date explanation for **11 vs 10**.

---

## 3. Alternate assignment mechanisms (`trip_assignments`, `vehicle_id`, `group_id`)

### `trip_assignments`

- Exists in DB (`database.types.ts` → `trip_assignments` with `trip_id`, `driver_id`).
- Used in **driver RLS** (`trips_select_own_driver` checks `trip_assignments` for `auth.uid()`).
- **Not used** in admin list query (`trips-listing.tsx`) for filtering.
- **Not used** in `applyExportFilters`.

**Effect on 10 vs 11:** A trip with **`driver_id IS NULL`** but a row in **`trip_assignments`** for the filtered driver UUID would be **excluded from both** list and export (both only filter `trips.driver_id`). That would make **list > export**, not export +1.

### `vehicle_id`

- Column on `trips`; **no filter** in list or export for driver UUID scenario.

### `group_id`

- Used for visual grouping / sorting in UI; **no filter** in list or export assignee branches.

### Display vs query (`resolveTripAssignee`)

```78:96:src/features/trips/lib/trip-assignee.ts
export function resolveTripAssignee(trip: TripAssigneeInput): TripAssignee {
  if (trip.fremdfirma_id) {
    return {
      kind: 'fremdfirma',
      id: trip.fremdfirma_id,
      label: trip.fremdfirma?.name ?? 'Fremdfirma',
      paymentMode: trip.fremdfirma?.default_payment_mode ?? null
    };
  }

  if (trip.driver_id) {
    return {
      kind: 'driver',
      id: trip.driver_id,
      label: trip.driver?.name ?? 'Fahrer'
    };
  }

  return { kind: 'unassigned', label: 'Nicht zugewiesen' };
}
```

UI shows **Fremdfirma** when `fremdfirma_id` is set, but **driver URL filter still matches on `driver_id` column only** — display precedence does not change SQL on either path.

---

## 4. `parseAssigneeFromUrl` — prefill for `driver_id=<UUID>`

### Complete function

```41:55:src/features/trips/hooks/use-export-filter-prefill.ts
function parseAssigneeFromUrl(
  driverIdParam: string | null
): ExportAssigneeFilter | null {
  const parsed = parseAssigneeParam(driverIdParam);
  switch (parsed.kind) {
    case 'unassigned':
      return { type: 'unassigned' };
    case 'driver':
      return { type: 'driver', driverId: parsed.id };
    case 'fremdfirma':
      return { type: 'fremdfirma', fremdfirmaId: parsed.id };
    default:
      return null;
  }
}
```

### Return value for plain UUID

**Input:** `driverIdParam = '<UUID>'`  
**`parseAssigneeParam`:** `{ kind: 'driver', id: '<UUID>' }`  
**Return:**

```ts
{ type: 'driver', driverId: '<UUID>' }
```

### Matches `applyExportFilters`?

**Yes.** Export schema expects:

```47:51:src/features/trips/lib/export-query.ts
  z.object({
    type: z.literal('driver'),
    driverId: uuidSchema
  }),
```

Preview serialization:

```206:211:src/features/trips/lib/export-query.ts
  if (filters.assigneeFilter) {
    if (filters.assigneeFilter.type === 'unassigned') {
      params.set('assignee_type', 'unassigned');
    } else if (filters.assigneeFilter.type === 'driver') {
      params.set('assignee_type', 'driver');
      params.set('assignee_id', filters.assigneeFilter.driverId);
```

**Caveat:** Prefill reads **`useSearchParams()` on the client**; list reads **`searchParamsCache`** on the server. If client params are stale when the dialog opens (missing `driver_id`), `parseAssigneeFromUrl(null)` → **`assigneeFilter: null`** → export runs **without** driver filter while RSC list already has UUID → **export 11, list 10**. Verify in Network tab: preview URL must include `assignee_type=driver&assignee_id=<UUID>`.

---

## 5. OR branches — could one side match MORE trips on driver filter?

### Driver / assignee OR with `driver_id IS NULL`?

**Neither side.** For `type: 'driver'` / `kind: 'driver'`:

- List: single `.eq('driver_id', uuid)` — no OR, no null fallback.
- Export: single `.eq('driver_id', uuid)` — no OR, no null fallback.

Other assignee cases (for completeness):

| Param | List | Export |
|-------|------|--------|
| `unassigned` | `.is('driver_id', null).is('fremdfirma_id', null)` | Same |
| `fremdfirma:<id>` | `.eq('fremdfirma_id', id)` | Same |
| `fremdfirma:all` | `.not('fremdfirma_id', 'is', null)` | **Not mapped** (prefill → `null`) |
| absent / `all` | no clause | no clause |

**No driver OR branch** causes export to include extra rows **when driver filter is applied on both sides**.

The **date** filter uses OR (scheduled vs unscheduled vs backlog) — see §6. That OR is **the same structure** on both sides; the **inner predicate for unscheduled `requested_date` differs** (eq vs gte/lte).

---

## 6. Today date filter — list vs export (exact clauses)

Assume URL `scheduled_at=2026-06-19` (today in business TZ), prefill `dateFrom = dateTo = 2026-06-19`.

### Shared bounds helper

Both call `getZonedDayBoundsIso('2026-06-19')` → `{ startISO, endExclusiveISO }` in **`Europe/Berlin`** (or `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`):

```41:52:src/features/trips/lib/trip-business-date.ts
export function getZonedDayBoundsIso(ymd: string): {
  startISO: string;
  endExclusiveISO: string;
} {
  const inTz = tz(getTripsBusinessTimeZone());
  const anchor = inTz(ymd);
  const dayStart = startOfDay(anchor, { in: inTz });
  const nextStart = addDays(dayStart, 1, { in: inTz });
  return {
    startISO: dayStart.toISOString(),
    endExclusiveISO: nextStart.toISOString()
  };
}
```

**ISO bounds are identical** when `dayStr === filters.dateFrom === filters.dateTo`.

### List — single-day YMD branch (today)

```279:301:src/features/trips/components/trips-listing.tsx
      } else if (parts.length === 1 && parts[0]) {
        const raw = parts[0].trim();
        let dayStr: string | null = null;

        if (isYmdString(raw)) {
          dayStr = raw;
        } else {
          const timestamp = Number(raw);
          if (!Number.isNaN(timestamp)) {
            dayStr = instantToYmdInBusinessTz(timestamp);
          }
        }

        if (dayStr) {
          const { startISO, endExclusiveISO } = getZonedDayBoundsIso(dayStr);
          const branches = [
            `and(scheduled_at.gte.${startISO},scheduled_at.lt.${endExclusiveISO})`,
            `and(scheduled_at.is.null,requested_date.eq.${dayStr})`
          ];
          if (todayYmdInBusinessTz() === dayStr) {
            branches.push(`and(scheduled_at.is.null,requested_date.is.null)`);
          }
          query = query.or(branches.join(','));
        }
      }
```

**List PostgREST `.or()` string (today, 3 branches):**

```
and(scheduled_at.gte.<startISO>,scheduled_at.lt.<endExclusiveISO>),
and(scheduled_at.is.null,requested_date.eq.2026-06-19),
and(scheduled_at.is.null,requested_date.is.null)
```

### Export — today single-day

```286:297:src/features/trips/lib/export-query.ts
  const dateBranches = [
    `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO})`,
    `and(scheduled_at.is.null,requested_date.gte.${filters.dateFrom},requested_date.lte.${filters.dateTo})`
  ];
  // WHY: mirrors the list view backlog branch so single-day table-view export includes the same undated trips the admin sees on screen.
  if (
    filters.dateFrom === filters.dateTo &&
    filters.dateFrom === todayYmdInBusinessTz()
  ) {
    dateBranches.push(`and(scheduled_at.is.null,requested_date.is.null)`);
  }
  let next = q.or(dateBranches.join(',')) as ChainableQuery;
```

**Export PostgREST `.or()` string (today, 3 branches):**

```
and(scheduled_at.gte.<startISO>,scheduled_at.lt.<endExclusiveISO>),
and(scheduled_at.is.null,requested_date.gte.2026-06-19,requested_date.lte.2026-06-19),
and(scheduled_at.is.null,requested_date.is.null)
```

### Side-by-side

| Branch | List | Export | Same? |
|--------|------|--------|-------|
| Scheduled in day | `scheduled_at.gte/start, scheduled_at.lt/endExclusive` | Same | ✓ |
| Unscheduled + requested date | **`requested_date.eq.<dayStr>`** | **`requested_date.gte.<from>, requested_date.lte.<to>`** | **Different PostgREST string** |
| Today backlog | `scheduled_at.is.null, requested_date.is.null` | Same (when `dayStr === todayYmdInBusinessTz()`) | ✓ |
| TZ / bounds | `getZonedDayBoundsIso` | Same helper | ✓ |
| Backlog guard | `todayYmdInBusinessTz() === dayStr` | `dateFrom === dateTo === todayYmdInBusinessTz()` | ✓ (equivalent for single-day today URL) |

### Could export include one extra unscheduled trip?

**For normal `date` / ISO `YYYY-MM-DD` values:** `eq.<day>` and `gte.<day>,lte.<day>` match the **same rows**. Unlikely +1 from this alone.

**Edge cases where export could be wider:**

1. **`dateFrom !== dateTo` in export** while URL looks like single day (prefill bug / stale params) → middle branch spans multiple days.
2. **`requested_date` non-date storage** (malformed string where gte/lte lexicographic range ≠ eq) — rare.
3. **`assigneeFilter` null on export** (§4) — extra trip is another driver’s trip for today, not an unscheduled edge case.

**List-only date nuance:** Date filter runs **only inside `if (scheduledAt)`** (line 234). Export **always** applies date. With `scheduled_at` in URL, both apply. If `scheduled_at` were missing, list would have **no date filter** (broader list) — opposite of 10 vs 11.

---

## Finding: the one clause that differs (driver + today)

| Layer | Differs? | Detail |
|-------|----------|--------|
| **Driver filter** | **No** (when applied) | Both: `.eq('driver_id', '<UUID>')` only |
| **Date — scheduled branch** | **No** | Same `getZonedDayBoundsIso` + gte/lt |
| **Date — backlog branch** | **No** | Same null/null when today |
| **Date — unscheduled requested_date** | **Yes (string only)** | List: **`requested_date.eq.<day>`** · Export: **`requested_date.gte.<day>,requested_date.lte.<day>`** |
| **Assignee actually applied on preview** | **Verify** | If missing → export has **no** `driver_id` filter |

### Most likely explanations for 11 vs 10 (ranked)

1. **Preview request missing assignee params** — client `useSearchParams()` without `driver_id` → `assigneeFilter: null` → 11 = all today’s trips; list RSC has driver filter → 10.
2. **Date prefill vs URL mismatch** — `dateFrom`/`dateTo` not equal to list `dayStr` (check preview `date_from`/`date_to` vs `scheduled_at`).
3. **`requested_date.eq` vs gte/lte** — low probability +1 for canonical DATE strings; align export to `eq` for single-day parity if (1–2) ruled out.

### Debug checklist

1. Network: `GET /api/trips/export/preview?...` — confirm `assignee_type=driver`, `assignee_id=<UUID>`, `date_from=date_to=<today>`.
2. Compare extra trip row: `driver_id`, `fremdfirma_id`, `scheduled_at`, `requested_date` — does it belong to another driver?
3. If extra trip has different `driver_id`, root cause is **missing export assignee filter**, not different driver SQL.

---

## File index

| File | Role |
|------|------|
| `trips-listing.tsx` L129–146, L234–301 | List assignee + today date OR |
| `export-query.ts` L281–330 | Export date OR + assignee |
| `use-export-filter-prefill.ts` L41–55, L113 | URL → `assigneeFilter` |
| `trip-assignee.ts` L30–52 | Shared URL parser |
| `trip-business-date.ts` L41–52 | Shared ISO day bounds |
