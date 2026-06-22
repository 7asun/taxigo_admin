# KTS Abrechnung Full Audit

## SECTION A - kts_status enum: current state & extension readiness

### A1. Current enum definition

`public.kts_status` is created in `supabase/migrations/20260610140000_kts_status.sql` and extended in `supabase/migrations/20260610170000_kts_abgerechnet_status.sql`.

```sql
CREATE TYPE public.kts_status AS ENUM (
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben'
);
```

```sql
ALTER TYPE public.kts_status
  ADD VALUE IF NOT EXISTS 'abgerechnet'
  AFTER 'uebergeben';
```

Generated type mirror in `src/types/database.types.ts`:

```ts
kts_status:
  | 'ungeprueft'
  | 'korrekt'
  | 'fehlerhaft'
  | 'in_korrektur'
  | 'uebergeben'
  | 'abgerechnet';
```

Current applied order: `ungeprueft`, `korrekt`, `fehlerhaft`, `in_korrektur`, `uebergeben`, `abgerechnet`.

### A2. Extension readiness for `bezahlt`

Yes. The enum is a PostgreSQL enum created with `CREATE TYPE public.kts_status AS ENUM (...)`, and it is already extended once with `ALTER TYPE public.kts_status ADD VALUE IF NOT EXISTS 'abgerechnet' AFTER 'uebergeben';`.

Application-layer allowlists / generated types that explicitly enumerate status values:

- `src/types/database.types.ts`: `Database['public']['Enums']['kts_status']` union and `Constants.public.Enums.kts_status`.
- `src/features/kts/kts.service.ts`: `KtsStatus` alias plus exported constants `KTS_STATUS_UNGEPRUEFT`, `KTS_STATUS_KORREKT`, `KTS_STATUS_FEHLERHAFT`, `KTS_STATUS_IN_KORREKTUR`, `KTS_STATUS_UEBERGEBEN`, `KTS_STATUS_ABGERECHNET`.
- `src/lib/kts-status.ts`: `ktsStatusBadge`, `KTS_STATUS_LABELS`, `KTS_STATUS_DOT`, `KTS_STATUS_VALUES`, `KTS_STATUS_ABGERECHNET`.
- `src/features/kts/components/kts-table/kts-actions-cell.tsx`: terminal/no-action guard `if (status === 'uebergeben' || status === 'abgerechnet')`.
- `src/features/kts/components/kts-table/index.tsx`: row selection guard `row.original.kts_status === 'korrekt'`.
- `src/features/kts/components/kts-table/kts-columns.tsx`: selection/status display uses `KTS_STATUS_KORREKT`, `KTS_STATUS_LABELS`, and `ktsStatusBadge`.
- `src/features/kts/components/kts-table/kts-handover-bulk-bar.tsx`: filters selected rows by `KTS_STATUS_KORREKT`.
- `src/features/kts/components/kts-table/kts-data-table.tsx`: error-row branches for `'fehlerhaft'` and `'in_korrektur'`.
- `src/features/kts/components/kts-filters-bar.tsx`: filter UI maps `KTS_STATUS_VALUES`, `KTS_STATUS_LABELS`, and `KTS_STATUS_DOT`.
- `src/features/kts/components/kts-csv-import-dialog.tsx`: `StatusBadge` uses `KTS_STATUS_LABELS` and `ktsStatusBadge`.
- `src/features/kts/lib/kts-csv-import-utils.ts`: `notUebergebenHint: !!trip && trip.kts_status !== 'uebergeben'`.
- `src/features/kts/components/kts-listing-page.tsx`: filters `.eq('kts_status', 'in_korrektur')` and `.in('kts_status', ktsStatusValues)`.
- `src/lib/searchparams.ts`: registers `kts_status` as a comma-separated enum-like URL filter; it does not validate enum values.

Postgres functions / migrations that reference status values by name:

- `supabase/migrations/20260610140000_kts_status.sql`: backfill sets `'in_korrektur'`, `'fehlerhaft'`, `'ungeprueft'`; syncs `kts_fehler` with `kts_status IN ('fehlerhaft', 'in_korrektur')`.
- `supabase/migrations/20260610150000_kts_queue_kpis.sql`: counts `t.kts_status = 'ungeprueft'` and `t.kts_status IN ('fehlerhaft', 'in_korrektur')`.
- `supabase/migrations/20260610160000_kts_handovers.sql`: validates `t.kts_status = 'korrekt'` and updates to `kts_status = 'uebergeben'`.
- `supabase/migrations/20260610170000_kts_abgerechnet_status.sql`: adds `'abgerechnet'` and comments the enum order.
- `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`, `20260610173000_kts_invoice_import_rpc_v2.sql`, and `20260610174000_kts_invoice_import_rpc_v3.sql`: set `kts_status = 'abgerechnet'::public.kts_status`.

RLS policies read for KTS tables (`kts_corrections`, `kts_handovers`, `kts_external_invoices`) filter only by `company_id`; no KTS RLS policy read references `kts_status` by value.

### A3. Planned order vs existing state machine

Existing documented order in `docs/kts-architecture.md`:

```md
| `ungeprueft` | Ungeprüft | Paper not yet checked, or returned and awaiting re-check |
| `korrekt` | Korrekt | Checked clean — ready for handover (PR3.3) |
| `fehlerhaft` | Fehlerhaft | Error recorded — not yet sent to issuer |
| `in_korrektur` | In Korrektur | Paper physically with issuer |
| `uebergeben` | Übergeben | Handed to accountant (PR3.3) |
| `abgerechnet` | Abgerechnet | Accountant invoice data stamped via CSV import (PR4) — **invoiced**, not paid |
```

Existing valid transitions:

```md
| KTS enabled | `ungeprueft` | `normalizeKtsPatch` rule A / `normalizeKtsInsert` |
| `ungeprueft` | `korrekt` | `markKtsChecked` |
| `ungeprueft` | `fehlerhaft` | `markKtsFehlerhaft` |
| `korrekt` | `fehlerhaft` | `markKtsFehlerhaft` (re-open) |
| `fehlerhaft` | `ungeprueft` | `clearKtsMistake` (PR3.2 queue) |
| `fehlerhaft` | `in_korrektur` | `sendKtsCorrection` |
| `in_korrektur` | `ungeprueft` | `receiveKtsCorrection` (re-check required) |
| `korrekt` | `uebergeben` | `createKtsHandover` / RPC `create_kts_handover` (PR3.3) |
| eligible trip | `abgerechnet` | RPC `apply_kts_invoice_import` (PR4) — does **not** require `uebergeben` |
| any / KTS off | `NULL` | `kts_document_applies: false` |
```

The planned order `ungeprueft -> korrekt -> fehlerhaft -> in_korrektur -> uebergeben -> abgerechnet -> bezahlt` is consistent as an enum order extension after `abgerechnet`, but the existing documented state machine is not strictly linear because `fehlerhaft` can return to `ungeprueft`, `in_korrektur` returns to `ungeprueft`, and `abgerechnet` can be reached from `eligible trip` without requiring `uebergeben`. Conflict: strict linear "only reachable from prior status" is not the current model for all earlier states.

### A4. `src/lib/kts-status.ts` exported constants

```ts
export const ktsStatusBadge = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      status: {
        ungeprueft: 'bg-muted text-muted-foreground border-border',
        korrekt:
          'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800',
        fehlerhaft:
          'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
        in_korrektur:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
        uebergeben:
          'bg-muted/50 text-muted-foreground border-border opacity-70',
        abgerechnet:
          'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
      }
    },
    defaultVariants: { status: 'ungeprueft' }
  }
);

export const KTS_STATUS_LABELS: Record<KtsStatus, string> = {
  ungeprueft: 'Ungeprüft',
  korrekt: 'Korrekt',
  fehlerhaft: 'Fehlerhaft',
  in_korrektur: 'In Korrektur',
  uebergeben: 'Übergeben',
  abgerechnet: 'Abgerechnet'
};

/** Filter dot colors — abgerechnet uses blue (green reserved for bezahlt in PR4.2). */
export const KTS_STATUS_DOT: Record<KtsStatus, string> = {
  ungeprueft: 'bg-muted-foreground',
  korrekt: 'bg-green-500',
  fehlerhaft: 'bg-red-500',
  in_korrektur: 'bg-amber-500',
  uebergeben: 'bg-muted-foreground/50',
  abgerechnet: 'bg-blue-500'
};

/** All kts_status values for filter UI. */
export const KTS_STATUS_VALUES: KtsStatus[] = [
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben',
  'abgerechnet'
];

export const KTS_STATUS_ABGERECHNET = 'abgerechnet' as const;
```

`bezahlt` would need to be represented in `ktsStatusBadge`, `KTS_STATUS_LABELS`, `KTS_STATUS_DOT`, and `KTS_STATUS_VALUES`. A dedicated exported constant equivalent to `KTS_STATUS_ABGERECHNET` is not currently present for other statuses in this file, but `src/features/kts/kts.service.ts` does export per-status constants.

### A5. `src/features/kts/kts.service.ts` status constants and status functions

Exported constants referencing `kts_status` values:

```ts
export const KTS_STATUS_UNGEPRUEFT = 'ungeprueft' as KtsStatus;
export const KTS_STATUS_KORREKT = 'korrekt' as KtsStatus;
export const KTS_STATUS_FEHLERHAFT = 'fehlerhaft' as KtsStatus;
export const KTS_STATUS_IN_KORREKTUR = 'in_korrektur' as KtsStatus;
export const KTS_STATUS_UEBERGEBEN = 'uebergeben' as KtsStatus;
export const KTS_STATUS_ABGERECHNET = 'abgerechnet' as KtsStatus;
```

Functions that filter, update, or transition `kts_status`:

- `isKtsErrorStatus(status: KtsStatus)`.
- `normalizeKtsPatch(patch)`.
- `normalizeKtsInsert(payload)`.
- `updateTripKts(tripId, patch)`.
- `markKtsChecked(tripId)`.
- `markKtsFehlerhaft(tripId, beschreibung)`.
- `clearKtsMistake(tripId)`.
- `sendKtsCorrection(supabase, payload)`.
- `receiveKtsCorrection(supabase, payload)`.
- `createKtsHandover(supabase, payload)` via RPC.
- `fetchKtsCandidateTrips(supabase, companyId)` reads candidates without filtering by `kts_status`.
- `applyKtsInvoiceImport(supabase, payload)` via RPC.

No service function guards against transitioning to or from `abgerechnet`. The only UI guard found is in `src/features/kts/components/kts-table/kts-actions-cell.tsx`:

```ts
if (status === 'uebergeben' || status === 'abgerechnet') {
  return <span className='text-muted-foreground text-xs'>—</span>;
}
```

The CSV import RPC sets `abgerechnet` without an existing-status guard:

```sql
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

## SECTION B - kts_external_invoices: the import batch table

### B1. Full table definition, indexes, RLS, policies, grants

`supabase/migrations/20260610171000_kts_external_invoices.sql`:

```sql
CREATE TABLE public.kts_external_invoices (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL
                                REFERENCES public.companies(id)
                                ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES auth.users(id)
                                ON DELETE SET NULL,
  kts_handover_id   uuid        REFERENCES public.kts_handovers(id)
                                ON DELETE SET NULL,
  row_count         integer     NOT NULL DEFAULT 0,
  source_filename   text
);
```

```sql
CREATE INDEX idx_kts_external_invoices_company_id
  ON public.kts_external_invoices (company_id);

CREATE INDEX idx_kts_external_invoices_company_created_at
  ON public.kts_external_invoices (company_id, created_at DESC);

CREATE INDEX idx_kts_external_invoices_handover_id
  ON public.kts_external_invoices (kts_handover_id)
  WHERE kts_handover_id IS NOT NULL;
```

```sql
ALTER TABLE public.kts_external_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kts_external_invoices_select"
  ON public.kts_external_invoices
  FOR SELECT
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_external_invoices_insert"
  ON public.kts_external_invoices
  FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

-- No UPDATE/DELETE policies — append-only audit; rows removed via CASCADE from companies.

GRANT SELECT, INSERT ON public.kts_external_invoices TO authenticated, service_role;
```

Generated type in `src/types/database.types.ts`:

```ts
kts_external_invoices: {
  Row: {
    company_id: string;
    created_at: string;
    created_by: string | null;
    id: string;
    kts_handover_id: string | null;
    row_count: number;
    source_filename: string | null;
  };
```

### B2. Total amount / pre-aggregated sum

No `total_amount`, sum, or amount column exists on `public.kts_external_invoices`. The table columns are `id`, `company_id`, `created_at`, `created_by`, `kts_handover_id`, `row_count`, and `source_filename`.

The amount is stored per trip:

```sql
ADD COLUMN IF NOT EXISTS kts_invoice_amount numeric(10, 2),
ADD COLUMN IF NOT EXISTS kts_eigenanteil numeric(10, 2),
ADD COLUMN IF NOT EXISTS kts_external_invoice_id uuid
  REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL;
```

Therefore totals by import batch must be computed from `trips.kts_invoice_amount` (and `trips.kts_eigenanteil`) grouped or filtered by `trips.kts_external_invoice_id`. The codebase contains no pre-aggregated table column for this.

### B3. `source_filename`

```sql
source_filename   text
```

Comment:

```sql
COMMENT ON COLUMN public.kts_external_invoices.source_filename IS
  'Original CSV filename for audit trail (display only, not parsed from DB).';
```

### B4. Rows per import

The RPC inserts exactly one `kts_external_invoices` row per `apply_kts_invoice_import(...)` call, then stamps all eligible trips with the returned `v_import_id`.

```sql
INSERT INTO public.kts_external_invoices (
  company_id,
  created_by,
  kts_handover_id,
  row_count,
  source_filename
)
VALUES (
  p_company_id,
  auth.uid(),
  p_handover_id,
  v_stamped_count,
  NULLIF(btrim(p_source_filename), '')
)
RETURNING id INTO v_import_id;
```

```sql
kts_external_invoice_id = v_import_id,
kts_status              = 'abgerechnet'::public.kts_status,
```

The table comment confirms the semantics:

```sql
COMMENT ON TABLE public.kts_external_invoices IS
  'Append-only audit log: one row per accountant CSV import run (PR4 Flow 2).';
```

## SECTION C - Grouping semantics: kts_belegnummer vs kts_external_invoice_id

### C1. Can one `kts_belegnummer` appear across multiple imports?

Yes by schema and RPC behavior, this is possible. No unique constraint exists on `trips.kts_belegnummer`, and the RPC skip guard checks whether the same trip already has a `kts_belegnummer`, not whether another import already used the same Belegnummer.

RPC validation:

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

RPC update guard:

```sql
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

No code read checks uniqueness of `r.belegnummer` across prior import batches. Runtime data distribution is `UNCLEAR` without querying data.

### C2. Can one `kts_external_invoice_id` contain multiple distinct `kts_belegnummer` values?

Yes. `p_rows` is a JSON array; the RPC inserts one import batch and then updates all eligible rows from `jsonb_to_recordset(p_rows)`, preserving each row's own `belegnummer` while assigning the same `v_import_id`.

```sql
UPDATE public.trips t
SET
  kts_belegnummer         = r.belegnummer,
  kts_invoice_amount      = r.invoice_amount,
  kts_eigenanteil         = r.eigenanteil,
  kts_external_invoice_id = v_import_id,
  kts_status              = 'abgerechnet'::public.kts_status,
  kts_patient_id          = CASE
                              WHEN NULLIF(btrim(t.kts_patient_id::text), '') IS NULL
                               AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL
                                THEN NULLIF(btrim(r.patient_id::text), '')
                              ELSE t.kts_patient_id
                            END
FROM jsonb_to_recordset(p_rows) AS r(
  trip_id        uuid,
  belegnummer    text,
  invoice_amount numeric,
  eigenanteil    numeric,
  patient_id     text
)
```

### C3. Correct grouping key for the Abrechnung view

The data model distinguishes invoice reference from import batch:

```sql
COMMENT ON COLUMN public.trips.kts_belegnummer IS
  'Rechnungsnummer from accountant invoice CSV. One Belegnummer may cover multiple trips '
  '(outbound + return). Stamped at CSV import time (Flow 2). NOT the Krankenkasse payment reference.';
```

```sql
COMMENT ON TABLE public.kts_external_invoices IS
  'Append-only audit log: one row per accountant CSV import run (PR4 Flow 2).';
```

Therefore, for an Abrechnung view whose row means "one invoice reference", the primary grouping key is `trips.kts_belegnummer`. `trips.kts_external_invoice_id` means "CSV upload/import run", not "invoice reference". If the UI must preserve upload-batch audit boundaries, the data supports a nested or composite display (`kts_external_invoice_id` -> `kts_belegnummer` -> trips), but `kts_external_invoice_id` alone is not the correct invoice grouping key.

### C4. `abgerechnet` rows with NULL `kts_belegnummer` or amount

The schema allows NULLs:

```sql
ADD COLUMN IF NOT EXISTS kts_belegnummer text,
ADD COLUMN IF NOT EXISTS kts_invoice_amount numeric(10, 2),
ADD COLUMN IF NOT EXISTS kts_eigenanteil numeric(10, 2),
ADD COLUMN IF NOT EXISTS kts_external_invoice_id uuid
  REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL;
```

Generated types:

```ts
kts_belegnummer: string | null;
kts_invoice_amount: number | null;
kts_eigenanteil: number | null;
kts_external_invoice_id: string | null;
```

The RPC writes `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, `kts_external_invoice_id`, and `kts_status = 'abgerechnet'` together for rows where `t.kts_belegnummer IS NULL`. No database constraint was found that enforces non-null invoice fields when `kts_status = 'abgerechnet'`. Such rows should not occur through the latest RPC write path, but they are possible by schema or other update paths. Existing runtime data is `UNCLEAR` without querying data.

## SECTION D - Bezahlt flow: what does "paid" mean operationally

### D1. Existing paid/payment UI or mutations

Search scope requested: `src/features/kts/` and `src/app/dashboard/kts/` for `bezahlt`, `paid`, `payment`, `bank`, `zahlung`.

Result: no matches found.

No existing KTS UI, mutation, service function, or RPC was found for marking a trip, Belegnummer group, or import batch as paid.

### D2. Existing RPC pattern and granularity

Current architecture uses RPCs for atomic multi-row status transitions:

`create_kts_handover` validates all selected trips and updates them together:

```sql
SELECT COUNT(*)::int INTO v_eligible
FROM public.trips t
WHERE t.id = ANY(p_trip_ids)
  AND t.company_id = p_company_id
  AND t.kts_status = 'korrekt'
  AND t.kts_document_applies = true;
```

```sql
UPDATE public.trips
SET
  kts_status       = 'uebergeben',
  kts_handover_id  = v_handover_id,
  kts_fehler       = false
WHERE id = ANY(p_trip_ids)
  AND company_id = p_company_id;
```

`apply_kts_invoice_import` inserts one import batch and updates all matched trips in one transaction. Based on the existing architecture, a group-level transition at Belegnummer granularity is consistent with an atomic RPC pattern, not a purely client-side sequence of separate trip updates. The codebase does not yet contain the paid-flow implementation, so the exact paid granularity is `UNCLEAR` from existing code alone.

### D3. Linear transition or correction path

Current documented state machine does not include `bezahlt`. Existing transition into `abgerechnet`:

```md
| eligible trip | `abgerechnet` | RPC `apply_kts_invoice_import` (PR4) — does **not** require `uebergeben` |
```

Future V2 conceptual lifecycle in `docs/kts-architecture.md`:

```md
States such as: Fehlerhaft → In Korrektur → Korrigiert → Abgegeben → Bezahlt, with possible loops when a Schein is still wrong after correction.
```

The user's planned constraint says `bezahlt` is only reachable from `abgerechnet` and terminal. Existing code/docs do not yet encode that. `UNCLEAR` from the codebase alone whether product still wants the older PR4.2 `versendet`, `bezahlt`, `ruecklaufer` model or the narrower terminal `bezahlt` only model.

### D4. Flow 3 / PR4.2 references

`docs/kts-architecture.md` mentions Flow 3 and PR4.2:

```md
Flow 2 (accountant invoice CSV): admin imports semicolon-delimited CSV from the accountant; system matches rows to trips (client-side in PR4.1), stamps invoice snapshot columns, sets `kts_status = abgerechnet`. **Amounts are invoiced, not paid** — Krankenkasse payment matching is Flow 3 (PR4.2: `versendet`, `bezahlt`, `ruecklaufer`).
```

```md
**Badge:** `abgerechnet` — blue cva variant + filter entry in `src/lib/kts-status.ts` (green reserved for `bezahlt` in PR4.2).

**Next:** PR4.2 (`versendet`, `bezahlt`, `ruecklaufer` + Krankenkasse payment CSV); PR4.3 (manual Unmatched linking, handover dropdown, import history).
```

```md
| **PR4.2** (next) | `versendet`, `bezahlt`, `ruecklaufer` enum values + Krankenkasse payment CSV (Flow 3) |
| **PR4.3** (after PR4.2) | Manual Unmatched linking, handover dropdown in import dialog, import history view |
| **Deferred** | Accountant gate — block handoff while open correction round exists |
| **PR5** | Bank CSV reconciliation against external invoice numbers |
| **PR6** (future) | Extended KTS-Abrechnung dashboard metrics |
```

## SECTION E - Current KTS table: columns, expand, and query shape

### E1. `kts_belegnummer` and `kts_invoice_amount` columns

`src/features/kts/components/kts-table/kts-columns.tsx`:

```tsx
{
  id: 'kts_belegnummer',
  accessorKey: 'kts_belegnummer',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Beleg-Nr.' />
  ),
  cell: ({ row }) => {
    const value = row.original.kts_belegnummer?.trim();
    if (!value) return null;
    return <span className='font-mono text-sm tabular-nums'>{value}</span>;
  },
  size: 100,
  maxSize: 100,
  meta: { label: 'Beleg-Nr.', variant: 'text' },
  enableColumnFilter: false,
  enableSorting: false
},
{
  id: 'kts_invoice_amount',
  accessorKey: 'kts_invoice_amount',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Betrag' />
  ),
  cell: ({ row }) => {
    const amount = row.original.kts_invoice_amount;
    if (amount == null) return null;
    return (
      <span className='text-sm tabular-nums'>
        {formatKtsInvoiceAmount(amount)}
      </span>
    );
  },
  size: 90,
  maxSize: 90,
  meta: { label: 'Betrag', variant: 'text' },
  enableColumnFilter: false,
  enableSorting: false
},
```

No `onClick` handler is present in either column.

### E2. Current RSC SELECT and query chain

`src/features/kts/components/kts-listing-page.tsx`:

```ts
const ktsListSelect = `
  *,
  kts_corrections(id, sent_at, received_at, sent_to)
`;
```

Full query chain:

```ts
let query = supabase
  .from('trips')
  .select(ktsListSelect, { count: 'exact' })
  .eq('kts_document_applies', true);

if (overdue && overdueTripIds) {
  query = query.eq('kts_status', 'in_korrektur').in('id', overdueTripIds);
} else if (ktsStatusValues.length > 0) {
  query = query.in('kts_status', ktsStatusValues);
}

if (search) {
  const term = search.replace(/'/g, "''");
  query = query.or(
    `client_name.ilike.%${term}%,kts_patient_id.ilike.%${term}%`
  );
}

// why: no default date filter — queue shows full backlog, oldest first for chronological processing.
query = query.order('scheduled_at', { ascending: true, nullsFirst: false });

if (page && pageLimit) {
  const from = (page - 1) * pageLimit;
  const to = from + pageLimit - 1;
  query = query.range(from, to);
}
```

Overdue pre-query:

```ts
const { data: overdueRows, error: overdueError } = await supabase
  .from('kts_corrections')
  .select('trip_id')
  .is('received_at', null)
  .lt('sent_at', cutoff);
```

### E3. Expand state and modes

`src/features/kts/components/kts-table/kts-actions-cell.tsx`:

```ts
export type KtsExpandState = { id: string; mode: 'fehler' | 'send' } | null;
```

Supported modes:

- `fehler`: opened from "Fehler melden" or "Erneut öffnen"; `KtsExpandRow` renders a `Textarea` and calls `useMarkKtsFehlerhaftMutation`.
- `send`: opened from "An Aussteller senden"; `KtsExpandRow` renders an `Input` and calls `useSendKtsCorrectionMutation`.

`src/features/kts/components/kts-table/kts-expand-row.tsx`:

```tsx
export interface KtsExpandRowProps {
  trip: KtsTripRow;
  mode: 'fehler' | 'send';
  onClose: () => void;
}
```

### E4. `KtsDataTable` generic type

`src/features/kts/components/kts-table/kts-data-table.tsx`:

```tsx
interface KtsDataTableProps<TData> extends React.ComponentProps<'div'> {
  table: TanstackTable<TData>;
  expandedRow: KtsExpandState;
  setExpandedRow: (val: KtsExpandState) => void;
  paginationProps?: Omit<DataTablePaginationProps<TData>, 'table'>;
}

export function KtsDataTable<TData extends KtsTripRow>({
  table,
  expandedRow,
  setExpandedRow,
  paginationProps,
  className,
  children
}: KtsDataTableProps<TData>) {
```

It has a generic parameter, but it is constrained to `TData extends KtsTripRow`, so it is not generic over arbitrary Abrechnung group rows.

### E5. `KtsFiltersBar` `totalItems`

`src/features/kts/components/kts-filters-bar.tsx`:

```ts
interface KtsFiltersBarProps {
  totalItems: number;
}
```

It displays the value:

```tsx
<span className='text-muted-foreground text-sm tabular-nums'>
  {totalItems} Belege
</span>
```

## SECTION F - KPIs: current display and update surface

### F1. Current KPI cards

`src/features/kts/components/kts-kpi-section.tsx` renders four `StatsCard` components:

```tsx
<StatsCard
  title='KTS Gesamt'
  value={data?.gesamt ?? 0}
  isLoading={isLoading}
/>
<StatsCard
  title='Ungeprüft'
  value={data?.ungeprueft ?? 0}
  description='Noch nicht geprüfte Belege'
  isLoading={isLoading}
/>
<StatsCard
  title='Fehler aktiv'
  value={data?.fehler_aktiv ?? 0}
  description='Fehlerhaft + In Korrektur'
  isLoading={isLoading}
/>
<StatsCard
  title='Überfällig'
  value={data?.ueberfaellig ?? 0}
  description='> 10 Tage ohne Rückmeldung'
  isLoading={isLoading}
/>
```

Data source: `const { data, isLoading } = useKtsKpis();`.

### F2. Fetch location

KPIs are fetched client-side via React Query in `src/features/kts/hooks/use-kts-kpis.ts`:

```ts
export function useKtsKpis() {
  return useQuery({
    queryKey: [...ktsKpiKey, 'company'],
    queryFn: async (): Promise<KtsQueueKpis> => {
      const supabase = createClient();
      const companyId = await fetchKtsCompanyId();
      if (!companyId) return EMPTY_KPIS;

      const { data, error } = await supabase.rpc('get_kts_queue_kpis', {
        p_company_id: companyId
      });
      if (error) throw error;
```

RPC shape in `supabase/migrations/20260610150000_kts_queue_kpis.sql`:

```sql
RETURNS TABLE (
  gesamt        bigint,
  ungeprueft    bigint,
  fehler_aktiv  bigint,
  ueberfaellig  bigint
)
```

### F3. Abrechnung KPI availability

Current KPI query returns only `gesamt`, `ungeprueft`, `fehler_aktiv`, and `ueberfaellig`. It does not return total Belegnummern, total invoiced amount, total Eigenanteil, or total paid amount.

`kts_invoice_amount` and `kts_eigenanteil` exist on `trips`, but no current KPI query aggregates them. `bezahlt` does not exist in the enum yet, so total paid amount cannot be computed from current status values.

## SECTION G - Realtime sync

### G1. `TripsRealtimeSync` implementation

`src/features/trips/components/trips-realtime-sync.tsx`:

```tsx
'use client';

/**
 * TripsRealtimeSync — Supabase Realtime on `trips` (INSERT + UPDATE).
 *
 * - Calls `refreshTripsPage()` from `TripsRscRefreshProvider` so **RSC** (Liste/Kanban)
 *   re-fetch and **TanStack Query** trip caches invalidate together (Option A for Query).
 * - **Debounced** so bursts of events do not hammer the server.
 *
 * Must mount under `TripsRscRefreshProvider` (see `FahrtenPageShell` on the Fahrten route).
 *
 * @see src/query/README.md — Query vs `router.refresh()`.
 */

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createDebouncedCallback } from '@/query/realtime-bridge';
import { useTripsRscRefresh } from '@/features/trips/providers';

const REALTIME_DEBOUNCE_MS = 450;

export function TripsRealtimeSync() {
  const { refreshTripsPage } = useTripsRscRefresh();

  useEffect(() => {
    const supabase = createClient();

    const { schedule, cancel } = createDebouncedCallback(
      () => refreshTripsPage(),
      REALTIME_DEBOUNCE_MS
    );

    const channel = supabase
      .channel('trips-realtime-sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trips' },
        schedule
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trips' },
        schedule
      )
      .subscribe();

    return () => {
      cancel();
      void supabase.removeChannel(channel);
    };
  }, [refreshTripsPage]);

  return null;
}
```

It subscribes to `public.trips` `INSERT` and `UPDATE`. On change, it calls `refreshTripsPage()` through a debounced callback.

### G2. Abrechnung refresh coverage

If a transition to `abgerechnet` or `bezahlt` updates rows in `public.trips`, `TripsRealtimeSync` will receive the `UPDATE` event and call `refreshTripsPage()`. If Abrechnung data depends on `public.kts_external_invoices` changes without corresponding trip updates, no current subscription covers `kts_external_invoices`.

## SECTION H - searchParams & tab routing

### H1. `view` usage

`src/lib/searchparams.ts` registers:

```ts
view: parseAsString.withDefault('list'),
```

Search in `src/features/kts/` and `src/app/dashboard/kts/` for `view`: no matches found.

The current default is `'list'`. It does not currently conflict with KTS behavior because KTS does not consume `view`; it is a mismatch with the proposed tab values `bearbeitung` and `abrechnung` unless the tab layer maps or replaces the default. Exact intended default is a product/router decision; current code says default is `list`.

### H2. `kts_status` default logic

The default is applied in the client filter bar, not in the RSC:

```tsx
/**
 * why: default queue view is ungeprueft — admin starts with unchecked papers (like Fahrten defaults to today).
 * One-time on mount; empty deps so we do not fight filter updates.
 */
useEffect(() => {
  if (searchParams.get('kts_status') != null) return;
  const params = new URLSearchParams(searchParams.toString());
  params.set('kts_status', 'ungeprueft');
  params.set('page', '1');
  const next = `${pathname}?${params.toString()}`;
  startTransition(() => {
    router.replace(next, { scroll: false });
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

RSC reads whatever is in `searchParamsCache`:

```ts
const ktsStatusValues = searchParamsCache.get('kts_status') ?? [];
```

Risk: if `KtsFiltersBar` mounts on an Abrechnung tab where `kts_status` is absent, it will write `kts_status=ungeprueft` into the URL. That default is client-side and unconditional on `view`.

### H3. Search-param tab routing behavior

`src/app/dashboard/kts/page.tsx` is a Server Component page with:

```ts
export const dynamic = 'force-dynamic';
```

It parses `searchParams` and renders `KtsListingPage` with the same promise:

```tsx
await searchParamsCache.parse(searchParams);
...
<KtsListingPage searchParams={searchParams} />
```

The current client filter updates use `router.replace(next, { scroll: false })`. In Next.js App Router, changing search params for a route re-navigates to that URL and causes Server Components that read `searchParams` to re-render/refetch. There is no KTS-specific client-side shortcut for `view`; no KTS `view` consumer exists today.

## SECTION I - Risk surface & deferred items

### I1. `kts_handover_id` and handover relationships

`supabase/migrations/20260610160000_kts_handovers.sql`:

```sql
CREATE TABLE public.kts_handovers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL
                          REFERENCES public.companies(id)
                          ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id)
                          ON DELETE SET NULL
);
```

Trip relationship:

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_handover_id uuid
  REFERENCES public.kts_handovers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.kts_handover_id IS
  'FK to the handover batch that transitioned this trip to uebergeben (PR3.3).';
```

External invoice relationship:

```sql
kts_handover_id   uuid        REFERENCES public.kts_handovers(id)
                              ON DELETE SET NULL,
```

Comment:

```sql
COMMENT ON COLUMN public.kts_external_invoices.kts_handover_id IS
  'Optional audit hint linking this import to a handover batch — not enforced 1:1; '
  'NULL when CSV spans multiple handovers or admin omitted handover context.';
```

Whether the Abrechnung view must surface handover information is not decided by code. The schema supports it as an optional audit hint. Product requirement: `UNCLEAR`.

### I2. Existing UI for `kts_external_invoices`

Search in `src/` for `kts_external_invoices` found references only in `src/types/database.types.ts` relationships/table types. No UI component, hook, service query, or page was found that reads and displays `public.kts_external_invoices`.

Current import batch history is therefore invisible to the admin in the app code read.

### I3. `kts_eigenanteil` display references

Search in `src/features/kts/` for `kts_eigenanteil`: no direct matches.

Search for `eigenanteil` shows it in CSV import preview/parsing/service flow:

`src/features/kts/components/kts-csv-import-dialog.tsx`:

```tsx
<TableHead className='text-right'>Eigenanteil</TableHead>
```

```tsx
<TableCell className='text-right'>
  {formatEur(row.eigenanteil)}
</TableCell>
```

`src/features/kts/lib/kts-csv-import-utils.ts`:

```ts
export const KTS_ACCOUNTANT_CSV_HEADERS = [
  'Transportdatum',
  'Patient',
  'Belegnummer',
  'Gesamtpreis',
  'Eigenanteil'
] as const;
```

`src/features/kts/kts.service.ts`:

```ts
eigenanteil: row.eigenanteil,
```

The main KTS listing table does not display `trips.kts_eigenanteil`.

### I4. Plan files touching KTS status / Belegnummer / invoice amount / external invoices

Relevant `.cursor/plans/` files found:

- `.cursor/plans/kts_document_workflow.plan.md` - active/stale: frontmatter has `status: in_progress` for `migration-kts-v1`, several `pending` items, and a deferred V2 `kts_reviews` item; current architecture doc says most V1 work is shipped, so status appears stale.
- `.cursor/plans/kts_pr3.1_status_b10cae3b.plan.md` - completed: all todos show `status: completed`; adds `kts_status`.
- `.cursor/plans/kts_pr3.2_queue_page_c140c62d.plan.md` - completed: queue page with filters/default `ungeprueft`; PR3.3 handover was deferred in this plan.
- `.cursor/plans/pr3.3_kts_handover_5df2b17f.plan.md` - completed: handover batch work; includes deferred accountant gate/mobile/optimistic/KPI breakdown.
- `.cursor/plans/pr4.1_csv_import_ui_307e1bf3.plan.md` - completed: all todos show `status: completed`; implements CSV import UI and `abgerechnet` badge/filter.
- `.cursor/plans/kts-patient-id-hardening_a91f454c.plan.md` - completed: patient ID hardening relevant to PR4.1.1 import backfill.

Relevant `docs/plans/` files found:

- `docs/plans/kts-abrechnung-audit.md` - completed audit just produced; says `kts_belegnummer` and `kts_invoice_amount` are structurally ready but runtime data completeness is `UNCLEAR`.
- `docs/plans/pr4-schema-audit.md` - completed/read-only audit for accountant CSV schema; covers `kts_external_invoices`, `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`.
- `docs/plans/pr4-csv-import-audit.md` - completed/read-only audit before CSV import.
- `docs/plans/pr4.1-ui-audit.md` - completed/read-only audit before CSV import Dialog; its executive summary marked CSV import button absent at that time.
- `docs/plans/pr4.1.1-audit.md` - plan/audit touching PR4.1.1 patient-ID import hardening; status not sampled in this audit document.
- `docs/plans/kts-pr3-1-status-audit.md` - completed: `**Status:** **COMPLETE**`.
- `docs/plans/kts-pr3-2-page-shell-audit.md` - completed: `**Status:** Complete`.
- `docs/plans/kts-rpc-tenant-guard-deferred.md` - resolved deferred security item: `**Status:** RESOLVED - 2026-06-10`.
- `docs/plans/kts-workflow-audit.md` - audit notes stale plan todos; explicitly says V2 `kts_reviews` lifecycle includes `Bezahlt` and is deferred.

## Senior Recommendation

1. Schema readiness: UI work for an Abrechnung tab that reads existing `abgerechnet` trips can start from the current schema. The required grouping and amount fields already exist: `trips.kts_belegnummer`, `trips.kts_invoice_amount`, `trips.kts_eigenanteil`, and `trips.kts_external_invoice_id`. No migration is required for a read-only Abrechnung view. A migration is required before any `bezahlt` flow: extend `public.kts_status` after `abgerechnet` and regenerate/update the TypeScript enum mirrors and status allowlists.

2. Build order: safest sequence is Abrechnung read-only tab first, then `bezahlt` schema/status extension, then paid transition. This keeps the first change inside existing shipped data and avoids adding a terminal state before there is a reconciliation surface to validate it. The `bezahlt` migration should precede any UI action or service call that can write that status.

3. Grouping key decision: the correct primary grouping key for the requested Abrechnung row is `kts_belegnummer`, because the schema comment defines it as the accountant invoice number and says one Belegnummer may cover multiple trips. `kts_external_invoice_id` is an import-run audit key, not an invoice-reference key. Because the schema does not prevent the same Belegnummer appearing in multiple import batches, the view should at least surface import-batch context for audit clarity; if product requires upload boundaries to remain distinct, the correct model becomes nested `kts_external_invoice_id -> kts_belegnummer -> trips`.

4. Biggest risk: data completeness and duplicate semantics around `kts_belegnummer` are the highest-risk item. The schema allows `abgerechnet` rows with NULL invoice fields and allows the same Belegnummer across multiple import batches. Mitigation is to verify real data before relying on aggregate totals, and to decide whether same-Belegnummer-across-imports means one invoice group or multiple audit groups.

5. Missing product decisions: whether `bezahlt` replaces the documented PR4.2 `versendet` / `bezahlt` / `ruecklaufer` model; whether paid is always terminal with no correction/reversal path; whether duplicate Belegnummer values across imports should merge or remain separated; whether the Abrechnung view must show handover batch metadata; and whether historical incomplete `abgerechnet` rows should be hidden, flagged, or backfilled.
