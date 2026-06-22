# KTS Belegnummer Uniqueness Audit

## Files Read

Read in the requested scope:

- `supabase/migrations/20260610171000_kts_external_invoices.sql`
- `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`
- Requested `supabase/migrations/20260610173000_kts_invoice_import_rpc_v3.sql` does not exist. Matching timestamped file read instead: `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql`.
- `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql`
- `src/types/database.types.ts` (`trips.Row` section only)
- `src/features/kts/lib/kts-csv-import-utils.ts`
- `src/features/kts/hooks/use-kts-csv-import.ts`

Additional KTS migration filename search found 13 KTS migrations. Search for `kts_belegnummer` found only these already-read files:

- `supabase/migrations/20260610171000_kts_external_invoices.sql`
- `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`
- `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql`
- `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql`

## Q1. UNIQUE CONSTRAINT

NO UNIQUE CONSTRAINT EXISTS.

No `UNIQUE` constraint, `UNIQUE` index, or exclusion constraint on `trips.kts_belegnummer` alone or with `company_id` was found in the migration files.

The only DDL that creates the column is in `supabase/migrations/20260610171000_kts_external_invoices.sql`:

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_belegnummer text,
  ADD COLUMN IF NOT EXISTS kts_invoice_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS kts_eigenanteil numeric(10, 2),
  ADD COLUMN IF NOT EXISTS kts_external_invoice_id uuid
    REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL;
```

Indexes created in the same file do not include `kts_belegnummer`:

```sql
CREATE INDEX IF NOT EXISTS idx_trips_kts_external_invoice_id
  ON public.trips (kts_external_invoice_id)
  WHERE kts_external_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trips_company_kts_patient_id
  ON public.trips (company_id, kts_patient_id)
  WHERE kts_document_applies = true
    AND kts_patient_id IS NOT NULL;
```

Generated `trips.Row` type in `src/types/database.types.ts`:

```ts
kts_belegnummer: string | null;
kts_invoice_amount: number | null;
kts_eigenanteil: number | null;
kts_external_invoice_id: string | null;
```

## Q2. APPLICATION-LAYER GUARD

NO CROSS-IMPORT BELEGNUMMER GUARD EXISTS.

In all versions of `apply_kts_invoice_import`, the guard checks only whether the target trip already has a non-null `kts_belegnummer`. It does not query for another trip in the same company with the same `belegnummer` and a different `kts_external_invoice_id`.

`supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`:

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

```sql
UPDATE public.trips t
SET
  kts_belegnummer         = r.belegnummer,
  kts_invoice_amount      = r.invoice_amount,
  kts_eigenanteil         = r.eigenanteil,
  kts_external_invoice_id = v_import_id,
  kts_status              = 'abgerechnet'::public.kts_status
FROM jsonb_to_recordset(p_rows) AS r(
  trip_id         uuid,
  belegnummer     text,
  invoice_amount  numeric,
  eigenanteil     numeric
)
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

`supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql` preserves the same Belegnummer guard:

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

```sql
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

`supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql` also preserves the same Belegnummer guard:

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

```sql
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

## Q3. SKIP LOGIC SCOPE

The guard prevents re-stamping the same trip. It does not prevent a different trip from receiving the same Belegnummer value that was used in a prior import.

Validation loop in latest RPC, `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql`:

```sql
SELECT
  t.id,
  t.company_id,
  t.kts_document_applies,
  t.kts_belegnummer
INTO v_trip
FROM public.trips t
WHERE t.id = v_row.trip_id;
```

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

Update clause in latest RPC:

```sql
FROM jsonb_to_recordset(p_rows) AS r(
  trip_id        uuid,
  belegnummer    text,
  invoice_amount numeric,
  eigenanteil    numeric,
  patient_id     text
)
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

Exact scope:

- The lookup is by `WHERE t.id = v_row.trip_id`.
- The update is by `WHERE t.id = r.trip_id`.
- The skip condition is `t.kts_belegnummer IS NULL` on that same target trip row.
- There is no `EXISTS (...)` check against other `public.trips` rows.
- There is no comparison of `r.belegnummer` against previously stamped rows.
- There is no check involving `kts_external_invoice_id` when deciding whether the same Belegnummer was already used in another import.

## Q4. CLIENT-SIDE VALIDATION

NO CLIENT-SIDE CROSS-IMPORT BELEGNUMMER CHECK EXISTS.

`src/features/kts/lib/kts-csv-import-utils.ts` does detect already-imported candidate trips, but only when the matched candidate trip itself has `kts_belegnummer != null`:

```ts
function partitionByImportStatus(
  csvRow: KtsCsvRow,
  trips: KtsCandidateTrip[],
  bucket: 'matched' | 'lowConfidence',
  lowConfidenceReason: string | null,
  result: KtsMatchResult,
  seen: Set<string>
): void {
  const uniqueTrips = dedupeTripsById(trips);
  const alreadyImported = uniqueTrips.filter((t) => t.kts_belegnummer != null);
  const fresh = uniqueTrips.filter((t) => t.kts_belegnummer == null);

  for (const trip of alreadyImported) {
    pushUniquePreviewRow(
      result.bereitsImportiert,
      seen,
      buildPreviewRow(csvRow, trip, {
        existingBelegnummer: trip.kts_belegnummer
      })
    );
  }

  for (const trip of fresh) {
    const row = buildPreviewRow(csvRow, trip, {
      lowConfidenceReason:
        bucket === 'lowConfidence' ? lowConfidenceReason : null
    });
    if (bucket === 'matched') {
      pushUniquePreviewRow(result.matched, seen, row);
    } else {
      pushUniquePreviewRow(result.lowConfidence, seen, row);
    }
  }
}
```

This is same-trip/candidate import-status partitioning. It does not search whether `csvRow.belegnummer` already exists on a different trip.

The helper `allShareSameBelegnummer` is used only to decide whether multiple candidate trips are ambiguous; it compares candidate trips already in memory, not prior imports by CSV Belegnummer:

```ts
function allShareSameBelegnummer(trips: KtsCandidateTrip[]): boolean {
  if (trips.length <= 1) return true;
  const belegSet = new Set(trips.map((t) => t.kts_belegnummer?.trim() ?? ''));
  return belegSet.size <= 1;
}
```

`src/features/kts/hooks/use-kts-csv-import.ts` passes selected rows to the import mutation without any cross-import Belegnummer validation:

```ts
await importMutation.mutateAsync({
  companyId,
  rows: checkedRows.map((row) => ({
    tripId: row.tripId!,
    belegnummer: row.belegnummer,
    invoiceAmount: row.gesamtpreis,
    eigenanteil: row.eigenanteil,
    patientId: matchedRowKeys.has(row.rowKey) ? row.patientId : null
  })),
  sourceFilename
});
```

## Q5. DATA MODEL INTENT

The migration comment does not state that `kts_belegnummer` is globally unique per company or unique per import batch. It explicitly states that one Belegnummer may cover multiple trips.

`supabase/migrations/20260610171000_kts_external_invoices.sql`:

```sql
COMMENT ON COLUMN public.trips.kts_belegnummer IS
  'Rechnungsnummer from accountant invoice CSV. One Belegnummer may cover multiple trips '
  '(outbound + return). Stamped at CSV import time (Flow 2). NOT the Krankenkasse payment reference.';
```

Related import-batch comment:

```sql
COMMENT ON TABLE public.kts_external_invoices IS
  'Append-only audit log: one row per accountant CSV import run (PR4 Flow 2).';
```

The comments establish two separate concepts:

- `trips.kts_belegnummer`: accountant invoice/reference value, may cover multiple trips.
- `kts_external_invoices`: one row per CSV import run.

They do not define a uniqueness invariant for `kts_belegnummer` across company or import batch.

## Q6. REAL DUPLICATION SCENARIO

Yes, this scenario is possible with the current RPC logic.

Exact sequence:

1. First import batch is submitted with `p_rows` containing trip A and `belegnummer = 'B-123'`.

2. RPC validation loop loads trip A by id:

```sql
FROM public.trips t
WHERE t.id = v_row.trip_id;
```

3. If trip A has no previous Belegnummer, the validation loop counts it for stamping:

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

4. The RPC inserts one import batch:

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

Call this returned id import X.

5. The RPC stamps trip A:

```sql
kts_belegnummer         = r.belegnummer,
kts_invoice_amount      = r.invoice_amount,
kts_eigenanteil         = r.eigenanteil,
kts_external_invoice_id = v_import_id,
kts_status              = 'abgerechnet'::public.kts_status
```

After first import: trip A has `kts_belegnummer = 'B-123'` and `kts_external_invoice_id = import X`.

6. Later, a second import batch is submitted with `p_rows` containing different trip B and the same `belegnummer = 'B-123'`.

7. RPC validation loop loads trip B by id. It does not load trip A by Belegnummer. If trip B's own `kts_belegnummer` is NULL, the row is counted:

```sql
WHERE t.id = v_row.trip_id;
```

```sql
IF v_trip.kts_belegnummer IS NOT NULL THEN
  v_skipped_ids := array_append(v_skipped_ids, v_row.trip_id);
ELSE
  v_stamped_count := v_stamped_count + 1;
END IF;
```

8. The RPC inserts a second `kts_external_invoices` row. Call this import Y.

9. The update stamps trip B because the WHERE clause is scoped to trip B and only requires trip B's own `kts_belegnummer IS NULL`:

```sql
WHERE t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL;
```

After second import: trip B has `kts_belegnummer = 'B-123'` and `kts_external_invoice_id = import Y`.

Final state: trip A and trip B are different trips, have the same `kts_belegnummer`, and have different `kts_external_invoice_id` values. No database constraint or application guard read prevents this.

## Q7. GROUPING SAFETY ASSESSMENT

If the Abrechnung view groups only by `kts_belegnummer` and sums `kts_invoice_amount`, then the Q6 scenario would combine trip A and trip B into one grouped row, even though they came from separate import batches.

That grouped row would show a total equal to:

```text
SUM(kts_invoice_amount) WHERE kts_belegnummer = 'B-123'
```

Under the current constraints, this can be an inflated or semantically mixed total if same-Belegnummer-across-imports represents duplicate/reused invoice references rather than one intended invoice group.

From the grouped row alone, the admin would not necessarily be able to detect that the row combines multiple `kts_external_invoice_id` values unless the grouped row also exposes import-batch count, source filenames, import ids, or expanded individual trips. The current requested grouping key alone is not safe under current constraints.

## Risk Verdict

The current data model is not safe enough to proceed with a Belegnummer-only Abrechnung grouping view unless the product explicitly accepts merging the same `kts_belegnummer` across different import batches. However, a plain UNIQUE constraint on `(company_id, kts_belegnummer)` is not compatible with the existing column comment because "One Belegnummer may cover multiple trips"; it would reject legitimate outbound/return rows sharing one Belegnummer. If a uniqueness constraint is still required, it should not be blindly `(company_id, kts_belegnummer)` without revising that data model intent; any enforceable constraint should be immediate rather than DEFERRABLE because the import RPC inserts/stamps in one statement and does not need temporary duplicates, and a data-cleaning/deduplication check is needed first because existing data may already contain duplicate `kts_belegnummer` values.
