# Export Button Location & Page Header Structure — Audit

**Scope:** Read-only audit of where the CSV export button lives on the Fahrten page, how `CsvExportDialog` is opened, and how URL prefill works.

**Date:** 2026-06-19

---

## Page header wiring (overview)

```
src/app/dashboard/trips/page.tsx
  PageContainer (pageTitle="Fahrten", pageHeaderAction=<TripsPageHeaderActions />)
    └── src/app/dashboard/trips/trips-header-actions.tsx  ← toolbar host
          ├── PrintTripsButton
          ├── DownloadCsvButton  ← export entry point
          ├── BulkUploadDialog
          └── AnsichtenDropdown
```

The Fahrten page uses `PageContainer` with `scrollable={false}`. The title/description render via `Heading` on the left; `pageHeaderAction` renders in a right-aligned flex row (`gap-2`, horizontal scroll on narrow screens).

---

## 1. Which file renders the export button?

| Layer | Component | File path |
|-------|-----------|-----------|
| **Page header slot** | `TripsPageHeaderActions` | `src/app/dashboard/trips/trips-header-actions.tsx` |
| **Export trigger + dialog host** | `DownloadCsvButton` | `src/features/trips/components/csv-export/download-csv-button.tsx` |
| **Wizard dialog** | `CsvExportDialog` | `src/features/trips/components/csv-export/csv-export-dialog.tsx` |

**Answer:** The visible export button is rendered by **`DownloadCsvButton`** in **`src/features/trips/components/csv-export/download-csv-button.tsx`**. It is mounted from **`TripsPageHeaderActions`** in **`src/app/dashboard/trips/trips-header-actions.tsx`**, which is passed as `pageHeaderAction` from **`src/app/dashboard/trips/page.tsx`**.

`CsvExportDialog` is not imported directly in the page header file; it is dynamically loaded inside `DownloadCsvButton`.

---

## 2. Full JSX around the export button (~20 lines)

### `trips-header-actions.tsx` (toolbar row)

```tsx
export function TripsPageHeaderActions() {
  return (
    <div className='flex shrink-0 flex-nowrap items-center justify-end gap-2'>
      <PrintTripsButton />
      <DownloadCsvButton />
      <BulkUploadDialog />
      <AnsichtenDropdown />
    </div>
  );
}
```

**Sibling controls (left → right):**

1. **`PrintTripsButton`** — print/ZIP export (`src/features/trips/components/print-trips-button.tsx`)
2. **`DownloadCsvButton`** — CSV export (opens `CsvExportDialog`)
3. **`BulkUploadDialog`** — bulk CSV upload (`src/features/trips/components/bulk-upload-dialog.tsx`)
4. **`AnsichtenDropdown`** — saved views / presets (`src/features/trips/components/ansichten-dropdown.tsx`)

All four are loaded with `next/dynamic` (`ssr: false`) and skeleton placeholders in `trips-header-actions.tsx`.

### `download-csv-button.tsx` (button + dialog)

```tsx
export function DownloadCsvButton() {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <>
      <Button
        variant='outline'
        className='gap-2'
        aria-label='CSV Export'
        title='CSV Export'
        onClick={() => setDialogOpen(true)}
      >
        <FileDown className='h-4 w-4 shrink-0' />
        <span className='hidden sm:inline'>CSV Export</span>
      </Button>

      <CsvExportDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
```

### `page-container.tsx` (header layout wrapping the toolbar)

```tsx
<div className='mb-4 flex min-w-0 shrink-0 flex-row items-start justify-between gap-2 sm:gap-4'>
  <div className='min-w-0 flex-1'>
    <Heading title={pageTitle ?? ''} description={pageDescription ?? ''} … />
  </div>
  {pageHeaderAction && (
    <div className='flex shrink-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto'>
      {pageHeaderAction}
    </div>
  )}
</div>
```

---

## 3. How is `CsvExportDialog` opened?

**Pattern:** `DownloadCsvButton` wrapper with **local React state**.

```tsx
const [dialogOpen, setDialogOpen] = React.useState(false);

// Open: Button onClick → setDialogOpen(true)
// Close: CsvExportDialog onOpenChange={setDialogOpen}
//        (also onOpenChange(false) after successful export, 1.5s delay)
```

- No URL param, no global store, no imperative ref API.
- `CsvExportDialog` is dynamically imported inside `DownloadCsvButton` (code-split).
- Dialog is always rendered as a sibling of the button (controlled `open` prop).

---

## 4. `CsvExportDialogProps` — full interface

From `csv-export-dialog.tsx` lines 32–35:

```tsx
interface CsvExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Answer:** **`CsvExportDialog` accepts only `open` and `onOpenChange`.** No `initialFilters`, `initialStep`, `mode`, or callback props.

Internal state (not props):

- `step: ExportStep` — wizard step
- `filters: ExportFilters`
- `selectedColumns: string[]`
- Preview/export loading and result state

On open, an effect resets wizard state and applies URL prefill:

```tsx
React.useEffect(() => {
  if (open) {
    setStep('payer');
    setFilters(prefillFilters);
    setSelectedColumns([]);
    setPreviewCount(null);
    setSampleTrips([]);
    setExportResult(null);
  }
}, [open, prefillFilters]);
```

---

## 5. What does `useExportFilterPrefill` return?

**Return type:** `ExportFilters` (full object, not a partial).

**Hook location:** `src/features/trips/hooks/use-export-filter-prefill.ts`

### URL → `ExportFilters` mapping

| URL param | ExportFilters field |
|-----------|---------------------|
| `payer_id` (comma UUIDs) | `payerIds` |
| `billing_variant_id` (comma UUIDs) | `billingVariantIds` |
| `driver_id` (assignee param) | `assigneeFilter` |
| `status` | `statusFilter` |
| `kts_filter` | `ktsFilter` |
| **`scheduled_at`** | **`dateFrom` / `dateTo`** |

### Date prefill — **yes, `scheduled_at` is translated**

`parseDateRangeFromScheduledAt()` handles:

1. **Range:** `"fromMs,toMs"` (two comma-separated epoch ms) → `dateFrom` / `dateTo` via `instantToYmdInBusinessTz()`
2. **Single day:** single numeric epoch ms → same YMD for both `dateFrom` and `dateTo`
3. **Missing/invalid:** falls through to defaults

Final assignment (lines 100–101):

```tsx
dateFrom: dateRange.dateFrom ?? defaults.dateFrom,
dateTo: dateRange.dateTo ?? defaults.dateTo
```

**Defaults when URL has no usable `scheduled_at`:** last 30 days through today (`createDefaultExportFilters()` in `csv-export.types.ts`).

**Note:** Prefill runs inside `CsvExportDialog` when the dialog opens; the hook reads `useSearchParams()` at that time. Date values are stored on `ExportFilters` but the wizard still shows the filter step first — date step comes second (`date-range`).

---

## 6. `mode` prop or open-at-specific-step?

**Answer:** **No.** There is no `mode`, `initialStep`, or similar prop.

- `ExportStep` type: `'payer' | 'date-range' | 'column-selector' | 'preview' | 'downloading'`
- Initial state: `useState<ExportStep>('payer')`
- Every time `open` becomes `true`, the effect sets `setStep('payer')`

The wizard **always starts at the filter step** (`'payer'`, titled “Export-Filter” in the dialog header), regardless of URL prefill completeness.

---

## 7. shadcn imports in the page header file — `DropdownMenu`?

**File:** `src/app/dashboard/trips/trips-header-actions.tsx`

**Imports:** Only `dynamic` from `next/dynamic`. **No shadcn UI imports** in this file.

| Child component | shadcn / UI imports relevant to toolbar |
|-----------------|----------------------------------------|
| `PrintTripsButton` | (separate file — Popover, Button, etc.) |
| `DownloadCsvButton` | `Button` from `@/components/ui/button` |
| `BulkUploadDialog` | Dialog stack (separate file) |
| **`AnsichtenDropdown`** | **`DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, …** plus `Button`, `Input`, `Tooltip` |

**Answer:** **`DropdownMenu` is not imported in `trips-header-actions.tsx`**, but it **is already used in the same toolbar row** via **`AnsichtenDropdown`** (`src/features/trips/components/ansichten-dropdown.tsx`). Adding a dropdown next to the export button would follow an existing pattern in the adjacent component, though it would require a new import in whichever file hosts the new UI (either extend `DownloadCsvButton` or `trips-header-actions.tsx`).

---

## Summary table

| Question | Finding |
|----------|---------|
| Export button renderer | `DownloadCsvButton` → `download-csv-button.tsx`; mounted by `TripsPageHeaderActions` |
| Toolbar neighbors | Print, **CSV Export**, Bulk Upload, Ansichten |
| Open/close | Local `useState` in `DownloadCsvButton`; `open` / `onOpenChange` only |
| Dialog props | `{ open, onOpenChange }` only |
| Prefill dates | **Yes** — `scheduled_at` → `dateFrom` / `dateTo` on `ExportFilters` |
| Initial step | Always `'payer'` (filter step); no mode prop |
| DropdownMenu in header file | Not in `trips-header-actions.tsx`; used in sibling `AnsichtenDropdown` |

---

## Files referenced

| Path | Role |
|------|------|
| `src/app/dashboard/trips/page.tsx` | Fahrten page; passes `TripsPageHeaderActions` |
| `src/app/dashboard/trips/trips-header-actions.tsx` | Header toolbar host |
| `src/features/trips/components/csv-export/download-csv-button.tsx` | Export button + dialog state |
| `src/features/trips/components/csv-export/csv-export-dialog.tsx` | Multi-step export wizard |
| `src/features/trips/hooks/use-export-filter-prefill.ts` | URL → `ExportFilters` prefill |
| `src/features/trips/types/csv-export.types.ts` | `ExportFilters`, `ExportStep`, defaults |
| `src/components/layout/page-container.tsx` | Page title + header action layout |
| `src/features/trips/components/ansichten-dropdown.tsx` | Neighbor `DropdownMenu` usage |
