# PR4.1 — KTS accountant CSV import UI audit

**Date:** 2026-06-10  
**Scope:** Read-only audit before implementing PR4.1 CSV import Dialog on top of shipped PR4 schema.  
**No code or schema changes in this document.**

**Files read:**

- [`src/app/dashboard/kts/kts-header.tsx`](../src/app/dashboard/kts/kts-header.tsx) *(note: not under `features/kts/components/` — lives in App Router)*
- [`src/app/dashboard/kts/page.tsx`](../src/app/dashboard/kts/page.tsx)
- [`src/app/dashboard/kts/kts-page-shell.tsx`](../src/app/dashboard/kts/kts-page-shell.tsx)
- [`src/features/kts/components/kts-table/kts-data-table.tsx`](../src/features/kts/components/kts-table/kts-data-table.tsx)
- [`src/features/kts/components/kts-table/index.tsx`](../src/features/kts/components/kts-table/index.tsx)
- [`src/features/kts/components/kts-listing-page.tsx`](../src/features/kts/components/kts-listing-page.tsx)
- [`src/features/kts/components/kts-filters-bar.tsx`](../src/features/kts/components/kts-filters-bar.tsx)
- [`src/features/kts/components/kts-table/kts-columns.tsx`](../src/features/kts/components/kts-table/kts-columns.tsx)
- [`src/features/kts/kts.service.ts`](../src/features/kts/kts.service.ts)
- [`src/features/kts/hooks/use-kts-status.ts`](../src/features/kts/hooks/use-kts-status.ts)
- [`src/features/kts/hooks/use-kts-kpis.ts`](../src/features/kts/hooks/use-kts-kpis.ts)
- [`src/features/trips/components/bulk-upload-dialog.tsx`](../src/features/trips/components/bulk-upload-dialog.tsx) (Papa Parse + step pattern)
- [`src/features/bank-reconciliation/components/zahlungsabgleich-dialog.tsx`](../src/features/bank-reconciliation/components/zahlungsabgleich-dialog.tsx)
- [`src/features/bank-reconciliation/hooks/use-zahlungsabgleich.ts`](../src/features/bank-reconciliation/hooks/use-zahlungsabgleich.ts)
- [`src/features/bank-reconciliation/lib/match-invoices.ts`](../src/features/bank-reconciliation/lib/match-invoices.ts)
- [`src/features/trips/components/csv-export/csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx)
- [`src/lib/kts-status.ts`](../src/lib/kts-status.ts)
- [`src/components/ui/dialog.tsx`](../src/components/ui/dialog.tsx)
- [`supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`](../supabase/migrations/20260610172000_kts_invoice_import_rpc.sql)
- [`docs/plans/pr4-schema-audit.md`](pr4-schema-audit.md)
- [`docs/plans/pr4-nonclient-name-audit.md`](pr4-nonclient-name-audit.md)
- [`src/query/keys/trips.ts`](../src/query/keys/trips.ts)

---

## Executive summary

| Topic | Finding |
| ----- | ------- |
| CSV import button | **Absent** — `KtsHeader` only toggles KPI section |
| Dialog pattern | shadcn `Dialog` — best prior art: **`ZahlungsabgleichDialog`** (upload → review buckets → confirm → done) |
| Papa Parse | **`Papa.parse(file, …)`** on `File` directly; accountant CSV should add **`delimiter: ';'`** (bank CSV uses this; bulk upload does not) |
| KTS list cache | **No React Query list** — RSC paginated props only; matching needs **dedicated client fetch** |
| Invalidation | Mirror **`useKtsMutationSideEffects`**: `tripKeys.all`, `tripKeys.detail(id)`, `ktsKpiKey`, **`refreshTripsPage()`** |
| Name utils | **`clientDisplayNameFromParts`** exists; **`normalizeCsvPatientName` is net-new** |
| Badge/filter PR4.1 | Update **`ktsStatusBadge` cva**, **`KTS_STATUS_VALUES`**, remove **`kts-columns` TODO fallback** |

---

## 1. `kts-header.tsx` — current state

**Path:** [`src/app/dashboard/kts/kts-header.tsx`](../src/app/dashboard/kts/kts-header.tsx) — not `src/features/kts/components/kts-header.tsx`.

**"CSV importieren" button:** **Does not exist** — no stub, disabled button, or import-related JSX.

**Props interface:** **None** — zero-props component:

```typescript
export function KtsHeader() {
  const [kpiOpen, setKpiOpen] = useState(true);
```

**Full JSX (only actions):**

```tsx
return (
  <div className='flex shrink-0 flex-col gap-4'>
    <div className='flex items-center justify-between'>
      <div>
        <h1 className='text-xl font-semibold'>KTS</h1>
        <p className='text-muted-foreground text-sm'>
          Belegprüfung und Korrekturverwaltung
        </p>
      </div>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='text-muted-foreground h-7 gap-1 text-xs'
        onClick={() => setKpiOpen((v) => !v)}
      >
        {kpiOpen ? (
          <>
            <ChevronUp className='h-3.5 w-3.5' />
            Ausblenden
          </>
        ) : (
          <>
            <ChevronDown className='h-3.5 w-3.5' />
            Übersicht anzeigen
          </>
        )}
      </Button>
    </div>
    <KtsKpiSection open={kpiOpen} onOpenChange={setKpiOpen} />
  </div>
);
```

**Dialog open state:** **Not managed** — header has only `kpiOpen` for KPI collapse. No import overlay. Parent [`page.tsx`](../src/app/dashboard/kts/page.tsx) renders `<KtsHeader />` with no dialog props:

```tsx
<KtsHeader />
<Suspense …>
  <KtsListingPage searchParams={searchParams} />
</Suspense>
```

**PR4.1 implication:** Add import trigger button + either (a) `useState` inside `KtsHeader` for `importOpen`, or (b) lift state to `page.tsx` / a small client wrapper — see §10.

---

## 2. Dialog pattern in use

### shadcn Dialog — confirmed

[`src/components/ui/dialog.tsx`](../src/components/ui/dialog.tsx) — Radix wrapper. Exports:

```typescript
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
};
```

Used by `bulk-upload-dialog.tsx`, `zahlungsabgleich-dialog.tsx`, `csv-export-dialog.tsx`.

### Multi-step dialogs — present

| Component | Step state | Pattern |
| --------- | ---------- | ------- |
| **`ZahlungsabgleichDialog`** | `step` from hook | String union: `'idle' \| 'loading' \| 'reviewing' \| 'confirming' \| 'done'` |
| **`CsvExportDialog`** | `useState<ExportStep>('payer')` | String literal union with back/next |
| **`BulkUploadDialog`** | `useState<'upload' \| 'resolve_clients' \| …>('upload')` | Mode string union |

**Best mirror for PR4.1:** **`ZahlungsabgleichDialog`** — CSV upload → parse/load → review table with buckets → confirm → done summary in same Dialog.

Step management quote (`use-zahlungsabgleich.ts`):

```typescript
const [step, setStep] = useState<DialogStep>('idle');
```

UI branches (`zahlungsabgleich-dialog.tsx`):

```tsx
{step === 'idle' && ( /* FileUploader */ )}
{step === 'loading' && <LoadingState … />}
{step === 'reviewing' && ( <ReviewTable … /> )}
{step === 'confirming' && <LoadingState … />}
{step === 'done' && ( /* success / partial failure summary */ )}
```

**No dedicated stepper component** — conditional render on string `step` / `mode` is the project convention.

---

## 3. Papa Parse usage in `bulk-upload-dialog.tsx`

**Import:**

```typescript
import Papa from 'papaparse';
```

**Parse call** — `File` passed directly (no `FileReader`):

```typescript
Papa.parse<ParsedCsvRow>(file, {
  header: true,
  skipEmptyLines: true,
  complete: async (papaResults) => {
    const rows = papaResults.data;
    // …
  },
});
```

(`bulk-upload-dialog.tsx` lines 606–609.)

**Config used:** `header: true`, `skipEmptyLines: true`. **No `delimiter`** — assumes comma/default. **No `encoding`**.

**Accountant CSV (semicolon):** Follow **`parse-bank-csv.ts`** which adds `delimiter: ';'`:

```typescript
Papa.parse<string[]>(file, {
  delimiter: ';',
  header: false,
  skipEmptyLines: true,
  complete: (results) => { … },
  error: (err) => { reject(err); },
});
```

**PR4.1 recommendation:** `Papa.parse(file, { delimiter: ';', header: true, skipEmptyLines: true, … })` — combine bulk-upload’s `header: true` with bank CSV’s semicolon delimiter.

---

## 4. Already-imported detection pattern

### Zahlungsabgleich — status field + bucket assignment

Matching runs client-side in `matchInvoices()` after loading invoice data. **`already_paid`** is detected via **invoice status**, not a Set pre-load:

```typescript
if (lookupInvoice.status !== 'sent') {
  warningReasons.push('already_paid');
}
// …
if (warningReasons.length > 0) {
  return { …, bucket: 'warning', …, warningReasons };
}
return { …, bucket: 'ready', … };
```

(`match-invoices.ts` lines 169–196.)

Buckets: `'ready' | 'warning' | 'ignored'` (`reconciliation.types.ts`). UI separates **`already_paid`** into an informational subsection (`review-table.tsx` filters `warningReasons.includes('already_paid')`).

Hook aggregates:

```typescript
const readyRows = useMemo(
  () => matchedRows.filter((r) => r.bucket === 'ready'),
  [matchedRows]
);
const ignoredCount = useMemo(
  () => matchedRows.filter((r) => r.bucket === 'ignored').length,
  [matchedRows]
);
```

### PR4.1 signal — no conflict

PR4.1 plan: **`trips.kts_belegnummer IS NOT NULL`** → **already-imported** bucket before RPC commit.

- Same **pattern**: classify during preview into buckets; RPC skip-not-fail is defense in depth (`apply_kts_invoice_import` skips rows where `kts_belegnummer IS NOT NULL`).
- Different **signal**: trip column vs invoice `status !== 'sent'`.
- No existing KTS code uses `kts_belegnummer` for UI bucketing yet.

---

## 5. `kts.service.ts` — mutation surface

**There is no `use-kts-mutations.ts`.** KTS React Query hooks live in:

- [`use-kts-status.ts`](../src/features/kts/hooks/use-kts-status.ts) — status transitions + handover
- [`use-kts-corrections.ts`](../src/features/kts/hooks/use-kts-corrections.ts) — correction CRUD
- [`use-update-kts-mutation.ts`](../src/features/kts/hooks/use-update-kts-mutation.ts) — inline table cells

### Exported functions in `kts.service.ts` (signatures)

| Export | Signature |
| ------ | ----------- |
| `KTS_SOURCE_MANUAL` | `'manual' as const` |
| `KTS_OVERDUE_DAYS` | `10` |
| `KtsStatus` | type alias from DB enum |
| `KTS_STATUS_*` | five status constants (no `ABGERECHNET` yet) |
| `normalizeKtsPatch` | `(patch: Partial<UpdateTrip>) => Partial<UpdateTrip>` |
| `normalizeKtsInsert` | `<T>(payload: T) => T` |
| `buildKtsPatchFromDrafts` | `(input: KtsDraftInput) => Partial<UpdateTrip>` |
| `updateTripKts` | `(tripId: string, patch: Partial<UpdateTrip>) => Promise<Trip>` |
| `markKtsChecked` | `(tripId: string) => Promise<Trip>` |
| `updateKtsPatientId` | `(tripId: string, patientId: string \| null) => Promise<Trip>` |
| `markKtsFehlerhaft` | `(tripId: string, beschreibung: string) => Promise<Trip>` |
| `clearKtsMistake` | `(tripId: string) => Promise<Trip>` |
| `sendKtsCorrection` | `(supabase, payload: SendKtsCorrectionPayload) => Promise<{ trip, correction }>` |
| `receiveKtsCorrection` | `(supabase, payload: ReceiveKtsCorrectionPayload) => Promise<{ trip, correction }>` |
| `createKtsHandover` | `(supabase, payload: CreateKtsHandoverPayload) => Promise<{ handoverId: string }>` |
| `fetchTripCorrections` | `(supabase, tripId: string) => Promise<KtsCorrection[]>` |
| `insertKtsCorrection` | `(supabase, payload: InsertKtsCorrectionPayload) => Promise<KtsCorrection>` |
| `closeKtsCorrection` | `(supabase, correctionId: string, receivedAt: Date) => Promise<KtsCorrection>` |

**No `applyKtsInvoiceImport` yet** — PR4.1 adds RPC wrapper here.

### Invalidation after successful KTS mutation

Shared helper in `use-kts-status.ts`:

```typescript
const onKtsWriteSuccess = async (tripId: string) => {
  void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
  void queryClient.invalidateQueries({ queryKey: tripKeys.all });
  void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
  if (rscRefresh) {
    await rscRefresh.refreshTripsPage();
  }
};

const onKtsBatchWriteSuccess = async (tripIds: string[]) => {
  for (const tripId of tripIds) {
    void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
  }
  void queryClient.invalidateQueries({ queryKey: tripKeys.all });
  void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
  if (rscRefresh) {
    await rscRefresh.refreshTripsPage();
  }
};
```

**PR4.1 `useApplyKtsInvoiceImportMutation` must:** call **`onKtsBatchWriteSuccess(stampedTripIds)`** (or equivalent) — **`tripKeys.all` + `ktsKpiKey` + `refreshTripsPage()`** are required because the KTS queue is **RSC**, not a dedicated React Query key.

---

## 6. KTS listing query key

**There is no React Query key for the KTS trip list.**

- [`kts-listing-page.tsx`](../src/features/kts/components/kts-listing-page.tsx) is an **async Server Component** — Supabase query server-side, passes `data` as props to `KtsTable`.
- [`kts-data-table.tsx`](../src/features/kts/components/kts-table/kts-data-table.tsx) is presentational — receives TanStack Table instance, **no `useQuery`**.
- [`kts-table/index.tsx`](../src/features/kts/components/kts-table/index.tsx) uses `useDataTable` for pagination/sorting only.

**Refresh mechanism:** [`TripsRscRefreshProvider`](../src/features/trips/providers/trips-rsc-refresh-provider.tsx) on KTS page:

```typescript
const refreshTripsPage = useCallback(async () => {
  await router.refresh();
  await queryClient.invalidateQueries({ queryKey: tripKeys.all });
}, [router, queryClient]);
```

**PR4.1 invalidation checklist:**

1. `await refreshTripsPage()` from `useOptionalTripsRscRefresh()` / `useTripsRscRefresh()`
2. `invalidateQueries({ queryKey: ktsKpiKey })` — KPI cards
3. Per stamped trip: `invalidateQueries({ queryKey: tripKeys.detail(tripId) })` if detail may be open

Do **not** search for a `['kts', 'trips']` query key — it does not exist.

---

## 7. `kts_status` badge + filter wiring (post-PR4)

### Full `kts-status.ts` (current)

```typescript
export const ktsStatusBadge = cva(…, {
  variants: {
    status: {
      ungeprueft: 'bg-muted text-muted-foreground border-border',
      korrekt: 'bg-green-50 text-green-700 border-green-200 …',
      fehlerhaft: 'bg-red-50 text-red-700 border-red-200 …',
      in_korrektur: 'bg-amber-50 text-amber-700 border-amber-200 …',
      uebergeben: 'bg-muted/50 text-muted-foreground border-border opacity-70'
      // NO abgerechnet variant yet
    }
  },
  defaultVariants: { status: 'ungeprueft' }
});

export const KTS_STATUS_LABELS: Record<KtsStatus, string> = {
  ungeprueft: 'Ungeprüft',
  korrekt: 'Korrekt',
  fehlerhaft: 'Fehlerhaft',
  in_korrektur: 'In Korrektur',
  uebergeben: 'Übergeben',
  abgerechnet: 'Abgerechnet'  // label present (PR4)
};

export const KTS_STATUS_DOT: Record<KtsStatus, string> = {
  ungeprueft: 'bg-muted-foreground',
  korrekt: 'bg-green-500',
  fehlerhaft: 'bg-red-500',
  in_korrektur: 'bg-amber-500',
  uebergeben: 'bg-muted-foreground/50',
  abgerechnet: 'bg-muted-foreground/50'  // placeholder = uebergeben (PR4)
};

export const KTS_STATUS_VALUES: KtsStatus[] = [
  'ungeprueft', 'korrekt', 'fehlerhaft', 'in_korrektur', 'uebergeben'
  // abgerechnet NOT in filter array (PR4.1)
];
```

### `kts-filters-bar.tsx` — filter array + dots

Imports centralized maps:

```typescript
import {
  KTS_STATUS_DOT,
  KTS_STATUS_LABELS,
  KTS_STATUS_VALUES
} from '@/lib/kts-status';
```

Filter renders **`KTS_STATUS_VALUES.map`** with **`KTS_STATUS_DOT[status]`** — no local dot map (PR4 wired import).

### `kts-columns.tsx` — badge + PR4 TODO

```typescript
// TODO PR4.1: abgerechnet badge variant in ktsStatusBadge cva
const badgeStatus =
  status === 'abgerechnet' ? 'uebergeben' : status;

<Badge className={ktsStatusBadge({ status: badgeStatus })}>
  {KTS_STATUS_LABELS[status]}
</Badge>
```

**PR4.1 must update:**

1. Add `abgerechnet` to **`ktsStatusBadge` cva**
2. Add `'abgerechnet'` to **`KTS_STATUS_VALUES`**
3. Set distinct **`KTS_STATUS_DOT.abgerechnet`**
4. Remove **`badgeStatus` workaround** in `kts-columns.tsx`

---

## 8. Name normalization — existing utils

### Found

**`clientDisplayNameFromParts`** — joins Vorname + Nachname with space (`build-trip-details-patch.ts`):

```typescript
export function clientDisplayNameFromParts(
  first: string,
  last: string,
  company?: string
): string {
  const parts = [first, last].map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return company?.trim() || '';
}
```

**Not found:** `normalizeClientName`, `parsePassengerName`, or CSV Patient parser in `src/lib/` / `src/utils/`.

**Related:** `resolveClientByName()` RPC wrapper — matches normalized full name against Stammdaten (`resolve-client-by-name.ts`); opposite direction from CSV parse.

### PR4.1 `normalizeCsvPatientName`

**Net-new utility** (suggested location: `src/features/kts/lib/normalize-csv-patient-name.ts`).

Contract:

```typescript
normalizeCsvPatientName(raw: string): {
  lastName: string;
  firstName: string;
  normalized: string;  // "Vorname Nachname" for compare to trips.client_name
  scheinId: string | null;  // trailing (NNNNN), skip when 0
}
```

Reuse **`clientDisplayNameFromParts`** for `normalized` output after parsing CSV `"Nachname, Vorname …"`. See [`pr4-nonclient-name-audit.md`](pr4-nonclient-name-audit.md).

---

## 9. Matching cascade — data at preview time

### What is loaded when admin opens `/dashboard/kts`?

**Only the current RSC page** (default `perPage` 50 via nuqs) — passed as props:

```typescript
const ktsListSelect = `
  *,
  kts_corrections(id, sent_at, received_at, sent_to)
`;
```

(`kts-listing-page.tsx` lines 33–36.)

**`SELECT *` on `trips` includes** (among others): `kts_patient_id`, `client_name`, `client_id`, `scheduled_at`, `kts_status`, `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, `kts_external_invoice_id`.

**Not included:**

- **`clients(...)` embed** — no `clients.first_name` / `clients.last_name` in listing
- **Full backlog** — paginated; filter may exclude `uebergeben` / `abgerechnet` rows
- **React Query cache** — data is not stored under `useQuery` for the list

### Field availability summary

| Field | In KTS list (`SELECT *`)? | Client join? |
| ----- | ------------------------- | ------------ |
| `kts_patient_id` | **Yes** | — |
| `client_name` | **Yes** | — |
| `kts_belegnummer` | **Yes** (PR4 column) | — |
| `scheduled_at` | **Yes** | — |
| `kts_status` | **Yes** | — |
| `clients.first_name` / `last_name` | **No** | **Not joined** |

### PR4.1 implication

**Cannot rely on React Query cache** for matching. **Dedicated fetch required** when Dialog opens or after CSV parse, e.g.:

```typescript
.from('trips')
.select('id, scheduled_at, kts_patient_id, client_name, client_id, kts_status, kts_belegnummer, …')
.eq('kts_document_applies', true)
// optional: .is('kts_belegnummer', null) for import candidates only
```

For **linked-client name fallback**, add **`clients(first_name, last_name)`** embed or server-side candidate RPC (per [`pr4-schema-audit.md`](pr4-schema-audit.md) §8). Matching against **`client_name` alone** works for non-client trips if normalization is correct; linked trips should prefer **`concat_ws(' ', clients.first_name, clients.last_name)`**.

---

## 10. Dialog open state — lifting pattern

### KTS page today

[`page.tsx`](../src/app/dashboard/kts/page.tsx) — **no overlay state**. [`KtsPageShell`](../src/app/dashboard/kts/kts-page-shell.tsx) only wraps `TripsRscRefreshProvider`.

KTS-specific dialogs today are **local to table cells**:

- `kts-actions-cell.tsx`: `const [handoverDialogOpen, setHandoverDialogOpen] = useState(false)` — **AlertDialog inside cell**
- `kts-handover-bulk-bar.tsx`: bulk handover AlertDialog state in bulk bar component

### Cross-feature pattern (Zahlungsabgleich)

Parent owns open state; Dialog is controlled:

```typescript
// invoice-list-table/index.tsx
const [zahlungsabgleichOpen, setZahlungsabgleichOpen] = useState(false);

{zahlungsabgleichOpen && (
  <ZahlungsabgleichDialog
    open={zahlungsabgleichOpen}
    onOpenChange={setZahlungsabgleichOpen}
  />
)}
```

**PR4.1 recommendation:** Same as Zahlungsabgleich — either:

- **`KtsHeader` client component** holds `importOpen` + renders `KtsCsvImportDialog`, **or**
- Small **`KtsPageClient`** wrapper in `page.tsx` wrapping header + dialog

Avoid URL-based state unless product wants shareable import links (not required).

---

## 11. Senior recommendation — PR4.1 scope

### A. Dialog steps (upload → preview → success)

**Yes — three steps match existing patterns.**

Map to Zahlungsabgleich-style string steps:

| PR4.1 step | Analog |
| ---------- | ------ |
| 1. Upload + parse | `step === 'idle'` + `loading` |
| 2. Preview (4 buckets) | `step === 'reviewing'` |
| 3. Success summary | `step === 'done'` |

**Step 3 vs toast:** Keep **in-dialog `done` step** (Zahlungsabgleich shows success/failure counts in Dialog). Optional **`toast.success`** after close for row count — not a substitute for summary when RPC partial-skips exist.

Four preview buckets (aligned with audits):

1. **Matched (ready)** — commit to RPC
2. **Unmatched** — no trip candidate
3. **Low-confidence** — name-only / ambiguous
4. **Already imported** — `kts_belegnummer IS NOT NULL` (mirror `already_paid` UX in Zahlungsabgleich)

### B. Matching location

**Hybrid — not cache-only.**

| Step | Where |
| ---- | ----- |
| Parse CSV | Client (Papa Parse, `delimiter: ';'`) |
| Load candidates | **Dedicated Supabase fetch** on dialog open or post-parse (not RSC page props) |
| Match cascade | Client TypeScript |
| Commit | **`apply_kts_invoice_import` RPC** with pre-matched `{ trip_id, belegnummer, invoice_amount, eigenanteil }[] |

Reasons cache-only fails:

- KTS list is **RSC + paginated**
- Default filter **`kts_status=ungeprueft`** hides import targets
- **No `clients` embed** for linked name fallback

Minimum fetch shape: all `kts_document_applies = true` trips with invoice columns + optional `clients(first_name, last_name)` for company scope via RLS.

### C. `abgerechnet` badge color

Current progression (`kts-status.ts`):

| Status | Badge | Dot |
| ------ | ----- | --- |
| `ungeprueft` | muted grey | `bg-muted-foreground` |
| `korrekt` | green | `bg-green-500` |
| `fehlerhaft` | red | `bg-red-500` |
| `in_korrektur` | amber | `bg-amber-500` |
| `uebergeben` | muted, **opacity-70** (terminal handover) | muted/50 |
| `abgerechnet` (placeholder) | same as uebergeben | same as uebergeben |

**Recommendation:** **`abgerechnet` = blue/slate “completed accounting”** — distinct from grey **`uebergeben`** (handed over, not yet invoiced), clearly “further along” without implying paid (PR4.2 `bezahlt` gets green-teal or similar).

Suggested cva (PR4.1):

```typescript
abgerechnet:
  'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
```

Dot: `bg-blue-500` or `bg-slate-500`.

Reserve **green** for future **`bezahlt`** (Flow 3) to avoid collision with **`korrekt`** (document QA, not payment).

### D. Missing infrastructure / risks / ordering

| Item | Risk | Mitigation |
| ---- | ---- | ---------- |
| **No `applyKtsInvoiceImport` in service** | Blocker | Add RPC wrapper + `useApplyKtsInvoiceImportMutation` first |
| **No candidate trip fetch** | Wrong matches | Fetch on dialog open; include `clients` embed |
| **Paginated RSC list** | False assumption of full data | Document in hook; never read `KtsTable` props for matching |
| **Semicolon CSV** | Parse failures | `delimiter: ';'` + validate headers (Transportdatum, Patient, Belegnummer, Gesamtpreis, …) |
| **Name format** | Silent non-match for ~30% non-client | `normalizeCsvPatientName` + compare to `client_name` / client join ([`pr4-nonclient-name-audit.md`](pr4-nonclient-name-audit.md)) |
| **Multi-trip per Belegnummer** | Outbound + return | Allow duplicate Belegnummer on N trips in commit payload |
| **RPC skip-not-fail** | Preview vs DB drift | Preview uses same `kts_belegnummer IS NOT NULL` rule; show skipped count on done step |
| **Badge/filter incomplete** | `abgerechnet` invisible in filter | PR4.1 updates cva + `KTS_STATUS_VALUES` + remove columns workaround |
| **`KTS_STATUS_ABGERECHNET` constant** | Optional | Add to `kts.service.ts` for parity |
| **Actions cell for `abgerechnet`** | Terminal state? | Likely dash like `uebergeben` — confirm in PR4.1 |
| **Berlin transport date** | TZ bugs | Use `getZonedDayBoundsIso` / existing trip-time helpers for date match |
| **Amount parsing** | German `€` / comma decimal | Mirror bank CSV `parseGermanAmount` pattern |

**Ordering dependencies:**

1. Service: `applyKtsInvoiceImport` + mutation hook with invalidation
2. Lib: `normalizeCsvPatientName` + match cascade + amount/date parsers
3. UI: Dialog + header button
4. Polish: badge/filter/actions for `abgerechnet`

---

## RPC reference (PR4 schema)

```sql
apply_kts_invoice_import(
  p_company_id      uuid,
  p_rows            jsonb,
  p_handover_id     uuid DEFAULT NULL,
  p_source_filename text DEFAULT NULL
) RETURNS uuid
```

Row shape: `{ trip_id, belegnummer, invoice_amount, eigenanteil }`.

Skip-not-fail when `trips.kts_belegnummer IS NOT NULL` — aligns with PR4.1 **already-imported** preview bucket.

---

*Audit complete — ready for PR4.1 implementation planning.*
