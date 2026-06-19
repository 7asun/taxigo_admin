# Export Route — `columns` Field vs CSV Output (Audit)

**Reported symptom:** POST `/api/trips/export` body includes a filtered `columns: string[]`, but the downloaded CSV contains **all** columns. Client sends the correct list; server appears to ignore it.

**Scope:** Read-only audit of [`src/app/api/trips/export/route.ts`](../src/app/api/trips/export/route.ts).

**Date:** 2026-06-19

---

## Executive summary

**Current codebase: the route does honour `columns`.** There is **no** separate `export-csv.ts` / `generate-export-csv.ts`. CSV generation is **inline** in the route handler.

Flow:

1. Body parsed with `exportRequestSchema` → `columns: string[]` extracted (line 48).
2. `selectedColumns = EXPORT_COLUMN_DEFS.filter((col) => columns.includes(col.key))` (lines 94–96).
3. Each CSV row built **only** from `selectedColumns` accessors (lines 105–110).
4. `papaparse.unparse` called with `fields: selectedColumns.map((col) => col.label)` (lines 113–116).

**The handler does not iterate all `EXPORT_COLUMN_DEFS` for output** — only the filtered subset.

If the downloaded file still looks like “all columns”, likely explanations **other than the route ignoring `columns`**:

| Explanation | Detail |
|-------------|--------|
| **Client sends a large `columns` array** | Table-view `resolveTableViewColumns` always appends **`EXPORT_ONLY_KEYS`** (~39 keys). A “short” visible-table selection can still be **50+ registry keys** in the POST body — feels like “everything” but is intentional client-side. |
| **Preview vs download confusion** | Preview sample uses `flattenTripForExportPreview` without column filter on the **count** query; download route **does** filter. Compare CSV header row to Network POST `columns.length`. |
| **Stale deployment / old route** | Historical audits ([`csv-export-audit.md`](csv-export-audit.md)) documented drift; current `route.ts` has registry-based filtering. Verify deployed revision matches repo. |
| **`includeHeaders` unused** | Parsed but not passed to `unparse` (headers always emitted via `fields`). Does **not** add extra data columns. |

**Minor gap:** Output column **order** follows **`EXPORT_COLUMN_DEFS` registry order**, not the order of keys in the request `columns` array.

---

## 1. Complete route handler — `columns` usage

**File:** [`src/app/api/trips/export/route.ts`](../src/app/api/trips/export/route.ts) (135 lines — full file shown below in logical sections)

### Parse body and read `columns`

```35:48:src/app/api/trips/export/route.ts
    const json = (await request.json().catch(() => null)) as unknown;
    const parseResult = exportRequestSchema.safeParse(json);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      return NextResponse.json(
        { error: `Ungültige Anfrage: ${errorMessage}` },
        { status: 400 }
      );
    }

    const { filters, columns } = parseResult.data;
```

- **`columns`** comes from Zod schema [`exportRequestSchema`](../src/features/trips/lib/export-query.ts) (lines 74–78): `z.array(z.string()).min(1)`.
- **`includeHeaders`** is also parsed (default `true`) but **never destructured or used** in the handler.

### Trip query (unrelated to column selection)

```68:92:src/app/api/trips/export/route.ts
    const admin = createAdminClient<Database>(supabaseUrl, serviceRoleKey);

    let query = admin
      .from('trips')
      .select(EXPORT_TRIPS_SELECT)
      .eq('company_id', companyId);

    query = applyExportFilters(query, filters);
    query = query.order('scheduled_at', { ascending: true });

    const { data: trips, error: tripsError } = await query;
    ...
    if (!trips || trips.length === 0) {
      return NextResponse.json(
        { error: 'Keine Fahrten für die ausgewählten Filter gefunden.' },
        { status: 404 }
      );
    }
```

`EXPORT_TRIPS_SELECT` embeds joins (`*`, payer, billing, driver, fremdfirma). That loads **full trip rows from DB** — but the CSV step below only **projects** selected columns.

### Filter registry defs by request `columns` (the critical filter)

```94:116:src/app/api/trips/export/route.ts
    const selectedColumns = EXPORT_COLUMN_DEFS.filter((col) =>
      columns.includes(col.key)
    );

    if (selectedColumns.length === 0) {
      return NextResponse.json(
        { error: 'Keine gültigen Spalten ausgewählt.' },
        { status: 400 }
      );
    }

    const csvRows = trips.map((trip) => {
      const row: Record<string, unknown> = {};
      selectedColumns.forEach((col) => {
        row[col.label] = col.accessor(trip as TripExportRow);
      });
      return row;
    });

    const csv = unparse({
      fields: selectedColumns.map((col) => col.label),
      data: csvRows
    });
```

### Response

```118:126:src/app/api/trips/export/route.ts
    const filename = `fahrten-export-${filters.dateFrom}-bis-${filters.dateTo}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
```

### Answers

| Question | Answer |
|----------|--------|
| Where is `columns` read? | Line **48**: `const { filters, columns } = parseResult.data` |
| Passed to CSV generation? | **Yes** — filters `EXPORT_COLUMN_DEFS` into `selectedColumns`; rows and `unparse` use only that array |
| Always all registry keys? | **No** — only defs whose `key` is in the request `columns` array |

---

## 2. CSV generation function — location and parameters

**There is no separate CSV module** in this repo (`export-csv.ts`, `generate-export-csv.ts`, etc.). Grep finds CSV build logic **only** in:

- [`src/app/api/trips/export/route.ts`](../src/app/api/trips/export/route.ts) — **download** (this audit)
- [`src/app/api/trips/export/preview/route.ts`](../src/app/api/trips/export/preview/route.ts) — preview samples via `flattenTripForExportPreview` (no file download)

### Inline “CSV builder” in the route

| Step | Code | Uses `columns`? |
|------|------|-----------------|
| Resolve defs | `EXPORT_COLUMN_DEFS.filter((col) => columns.includes(col.key))` | **Yes** |
| Build rows | `selectedColumns.forEach((col) => { row[col.label] = col.accessor(trip) })` | **Yes** — one cell per selected def |
| Serialize | `unparse({ fields: selectedColumns.map((col) => col.label), data: csvRows })` | **Yes** — Papa Parse restricted to those labels |

**Library:** [`papaparse`](https://www.papaparse.com/) `unparse` — imported line 5.

**Does not accept a standalone `columns` parameter** — it closes over `columns` / `selectedColumns` from the handler scope.

---

## 3. Where `EXPORT_COLUMN_DEFS` is iterated — and what to filter

### Registry definition (all possible columns)

```77:77:src/features/trips/lib/export-columns.registry.ts
export const EXPORT_COLUMN_DEFS: ExportColumnDef[] = [
```

57 column defs (keys like `id`, `scheduled_date`, … `needs_driver_assignment`).

### In the route — **two** touches of `EXPORT_COLUMN_DEFS`

**A) Filter step (already filtered by request — this is NOT “output all”)**

```94:96:src/app/api/trips/export/route.ts
    const selectedColumns = EXPORT_COLUMN_DEFS.filter((col) =>
      columns.includes(col.key)
    );
```

**B) Row/header build (iterates `selectedColumns` only, not full registry)**

```105:115:src/app/api/trips/export/route.ts
    const csvRows = trips.map((trip) => {
      const row: Record<string, unknown> = {};
      selectedColumns.forEach((col) => {
        row[col.label] = col.accessor(trip as TripExportRow);
      });
      return row;
    });

    const csv = unparse({
      fields: selectedColumns.map((col) => col.label),
```

**If the bug were “always all columns”, the fix would be at lines 94–96** — but **that filter already exists**. A regression would mean this block was removed or bypassed.

### What is *not* filtered

| Item | Behaviour |
|------|-----------|
| **Supabase `select(EXPORT_TRIPS_SELECT)`** | Always `*` + joins — full row in memory; does not affect CSV column count |
| **Invalid / unknown keys in `columns`** | Silently dropped (no matching def in filter) |
| **Request column order** | **Ignored** — output order = registry order among selected defs |
| **`includeHeaders: false`** | **Not implemented** — `unparse` always writes header row from `fields` |

---

## Client POST shape (reference)

[`csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx) sends:

```211:215:src/features/trips/components/csv-export/csv-export-dialog.tsx
        body: JSON.stringify({
          filters,
          columns: selectedColumns,
          includeHeaders: true
        })
```

Table-view `selectedColumns` = `resolveTableViewColumns(liveVisibility)` → mapped visible keys **+** `EXPORT_ONLY_KEYS`.

---

## Verification checklist (if symptom persists)

1. **Network tab:** POST `/api/trips/export` → copy `columns` array length and first/last keys.
2. **Downloaded CSV:** count header cells (semicolon or comma delimiter per Papa default).
3. **Compare:** header count should equal `selectedColumns.length` (= intersection of request keys with registry), **not** 57 unless the client sent all 57 keys.
4. **Registry count:** `EXPORT_COLUMN_DEFS.length` === 57 in [`export-columns.registry.ts`](../src/features/trips/lib/export-columns.registry.ts).
5. **If header count === 57 but POST `columns.length` < 57:** investigate proxy/cache/wrong endpoint — **contradicts current route source**.
6. **If header count === POST `columns.length` but still “too many”:** client is sending a large list (especially `EXPORT_ONLY_KEYS`); fix is **client column selection**, not route filtering.

---

## Historical note

[`docs/plans/csv-export-audit.md`](csv-export-audit.md) (pre-refactor) documented UI/API column registry drift and asked whether the route selects only requested columns. **Current `route.ts` implements registry-based filtering** (post-refactor per [`csv_export_refactor` plan](../.cursor/plans/csv_export_refactor_0a510f35.plan.md)).

---

## File index

| File | Role |
|------|------|
| `src/app/api/trips/export/route.ts` | POST handler + inline CSV build |
| `src/features/trips/lib/export-query.ts` | `exportRequestSchema` |
| `src/features/trips/lib/export-columns.registry.ts` | `EXPORT_COLUMN_DEFS`, accessors |
| `src/features/trips/components/csv-export/csv-export-dialog.tsx` | Client POST body |
