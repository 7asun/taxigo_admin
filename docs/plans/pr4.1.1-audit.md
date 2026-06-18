# PR4.1.1 audit — patient_id writeback

Read-only audit of the three layers PR4.1.1 touches: RPC migration, service payload, and commit path. No code or schema changes were made.

**Audit date:** 2026-06-10

---

## 1. RPC migration status

**Does `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql` exist?**

**Yes.** The file is present in the repository.

The v2 migration uses `CREATE OR REPLACE FUNCTION public.apply_kts_invoice_import(...)` and replaces the v1 definition from `20260610172000_kts_invoice_import_rpc.sql` when applied.

### Full UPDATE statement (v2)

```sql
  -- why: COALESCE(NULLIF(btrim(r.patient_id), ''), t.kts_patient_id) — never overwrite
  -- an existing Schein-ID with null when CSV row omits patient_id.
  UPDATE public.trips t
  SET
    kts_belegnummer         = r.belegnummer,
    kts_invoice_amount      = r.invoice_amount,
    kts_eigenanteil         = r.eigenanteil,
    kts_external_invoice_id = v_import_id,
    kts_status              = 'abgerechnet'::public.kts_status,
    kts_patient_id          = COALESCE(
                                NULLIF(btrim(r.patient_id::text), ''),
                                t.kts_patient_id
                              )
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

**Source:** `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql`, lines 108–131.

**COALESCE guard:** Present. `kts_patient_id` is set via `COALESCE(NULLIF(btrim(r.patient_id::text), ''), t.kts_patient_id)` — empty/null payload values do not overwrite an existing trip Schein-ID.

### v1 (original) — still the pre-v2 definition

If v2 has **not** been applied to the database, the live RPC is still defined by `20260610172000_kts_invoice_import_rpc.sql`, which has **no** `patient_id` field and **no** `kts_patient_id` writeback:

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
  ...
```

**Source:** `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`, lines 107–123.

**Note:** This audit confirms the **migration file** exists in the repo. Whether v2 is **live** on a given Supabase project depends on migration apply state (`supabase db push` / CI deploy) — not verified here.

---

## 2. `ApplyKtsInvoiceImportPayload` — current shape

**File:** `src/features/kts/kts.service.ts`, lines 490–501.

```typescript
export interface ApplyKtsInvoiceImportPayload {
  companyId: string;
  rows: Array<{
    tripId: string;
    belegnummer: string;
    invoiceAmount: number;
    eigenanteil: number;
    patientId?: string | null;
  }>;
  handoverId?: string | null;
  sourceFilename?: string | null;
}
```

**Answer:** `patientId?: string | null` is **already present** on each row element. This is not the original 4-field-only shape.

---

## 3. RPC row mapping in `applyKtsInvoiceImport`

**File:** `src/features/kts/kts.service.ts`, lines 537–543.

```typescript
  const pRows = payload.rows.map((row) => ({
    trip_id: row.tripId,
    belegnummer: row.belegnummer,
    invoice_amount: row.invoiceAmount,
    eigenanteil: row.eigenanteil,
    patient_id: row.patientId ?? null
  }));
```

**Answer:** `patient_id: row.patientId ?? null` is **already included** in the snake_case RPC payload mapping.

---

## 4. Dialog commit path

**File requested:** `src/features/kts/components/kts-csv-import-dialog.tsx`

**Finding:** The dialog file does **not** contain a commit/payload construction block. It delegates all import orchestration to `useKtsCsvImport()` and triggers commit via `onConfirm`:

```typescript
// kts-csv-import-dialog.tsx, lines 397–398
onClick={() => void onConfirm()}
```

The checked-rows → mutation payload mapping lives in **`src/features/kts/hooks/use-kts-csv-import.ts`**, inside `onConfirm`:

```typescript
// use-kts-csv-import.ts, lines 176–205
    const checkedRows: KtsMatchPreviewRow[] = [
      ...matchResult.matched.filter((r) => selectedMatchedIds.has(r.rowKey)),
      ...matchResult.lowConfidence.filter((r) =>
        selectedLowConfidenceIds.has(r.rowKey)
      )
    ];

    ...

      await importMutation.mutateAsync({
        companyId,
        rows: checkedRows.map((row) => ({
          tripId: row.tripId!,
          belegnummer: row.belegnummer,
          invoiceAmount: row.gesamtpreis,
          eigenanteil: row.eigenanteil,
          // why: PR4.1.1 writeback — admin-approved Schein-ID enables Step 1 match on next import.
          patientId: row.patientId
        })),
        sourceFilename
      });
```

**Answer:** `patientId: row.patientId` is **already included** in the commit mapping. The dialog wires the button to this hook; it does not map rows itself.

---

## 5. `KtsMatchPreviewRow` — `patientId` field

**File:** `src/features/kts/lib/kts-csv-import-utils.ts`, lines 38–55.

```typescript
export type KtsMatchPreviewRow = {
  rowKey: string;
  csvRowIndex: number;
  tripId: string | null;
  transportdatum: string;
  patient: string;
  belegnummer: string;
  gesamtpreis: number;
  eigenanteil: number;
  tripScheduledAt: string | null;
  tripPassengerName: string | null;
  ktsStatus: KtsStatus | null;
  notUebergebenHint: boolean;
  lowConfidenceReason: string | null;
  existingBelegnummer: string | null;
  /** Schein-ID from CSV — written back to trip on commit when admin checks the row (PR4.1.1). */
  patientId: string | null;
};
```

**Answer:** `patientId: string | null` is **already present** on `KtsMatchPreviewRow`.

---

## 6. `normalizeCsvPatientName` — `scheinId` output and preview population

### Return type includes `scheinId`

**File:** `src/features/kts/lib/kts-csv-import-utils.ts`, lines 86–91 and 120–125.

```typescript
export function normalizeCsvPatientName(raw: string): {
  lastName: string;
  firstName: string;
  normalized: string;
  scheinId: string | null;
} {
```

```typescript
  return {
    lastName,
    firstName,
    normalized: clientDisplayNameFromParts(firstName, lastName),
    scheinId
  };
```

`scheinId` is derived from trailing `(digits)` in the Patient column; `(0)` is treated as sentinel → `null` (lines 94–96).

### `patientId` set on every preview row via `buildPreviewRow`

**File:** `src/features/kts/lib/kts-csv-import-utils.ts`, lines 214–244.

```typescript
function buildPreviewRow(
  csvRow: KtsCsvRow,
  trip: KtsCandidateTrip | null,
  opts: {
    lowConfidenceReason?: string | null;
    existingBelegnummer?: string | null;
  } = {}
): KtsMatchPreviewRow {
  ...
  const { scheinId } = normalizeCsvPatientName(csvRow.patient);

  return {
    ...
    patientId: scheinId
  };
}
```

All buckets (matched, lowConfidence, unmatched, bereitsImportiert) flow through `buildPreviewRow` or `partitionByImportStatus` → `buildPreviewRow`, so **every preview row** gets `patientId` from the CSV Patient string — including unmatched rows (where `trip` is `null` but CSV Schein-ID is still captured).

**Answer:** `scheinId` is returned by `normalizeCsvPatientName` and mapped to `patientId` on preview rows during `matchKtsCsvRows`.

---

## 7. Gap summary

| Item | Status | Notes |
|------|--------|-------|
| **a) v2 migration file** | **Present in repo** | File exists at `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql` with COALESCE writeback. **Deploy gap only:** must be applied to Supabase for live RPC to accept `patient_id`. |
| **b) `patientId` in `ApplyKtsInvoiceImportPayload` rows** | **Already implemented** | Optional field on row type (see §2). |
| **c) `patient_id` in RPC row mapping** | **Already implemented** | `patient_id: row.patientId ?? null` (see §3). |
| **d) `patientId` in `KtsMatchPreviewRow` type** | **Already implemented** | Required field (see §5). |
| **e) `patientId` population in `buildPreviewRow` / `matchKtsCsvRows`** | **Already implemented** | `patientId: scheinId` from `normalizeCsvPatientName(csvRow.patient)` (see §6). |
| **f) `patientId` in dialog commit mapping** | **Already implemented (in hook, not dialog)** | `patientId: row.patientId` in `use-kts-csv-import.ts` `onConfirm` (see §4). Dialog has no inline mapping. |

### Conclusion

**Application code for PR4.1.1 is complete** across service, matching utils, and commit hook. No TypeScript changes are required for patient_id writeback based on this audit.

**Remaining action (operational, not code):** Apply migration `20260610173000_kts_invoice_import_rpc_v2.sql` to the target Supabase project if not already deployed. Until then, the client sends `patient_id` in the RPC payload but the live v1 function ignores it.

---

## v3 hardening (PR4.1.1 — post-audit)

**Problem with v2:** `COALESCE(NULLIF(btrim(r.patient_id), ''), t.kts_patient_id)` prevents null overwrite but can clobber an existing trip ID with a different CSV value (e.g. re-import row with different Schein-ID). Client master (`clients.kts_patient_id`) was never touched.

**v3 fixes (migration `20260610174000_kts_invoice_import_rpc_v3.sql`):**

1. **trips.kts_patient_id — null-only / no-clobber:** `COALESCE` replaced with a guarded `CASE` that writes only when the trip field is currently empty, keeps existing value if it conflicts, and uses `btrim` normalization on both sides so whitespace-only differences are treated as equal.
2. **clients.kts_patient_id — client master backfill (same transaction):** new `UPDATE clients` after the trip update — writes when `trips.client_id` is set and `clients.kts_patient_id` is empty. No-clobber enforced by `WHERE` clause (empty clients only).
3. **App-layer gate:** `use-kts-csv-import.ts` `onConfirm` now sends `patientId` only for matched (exact) bucket rows; low-confidence rows send `null`.

**RPC signature and grants:** unchanged from v2 (same function identity — `CREATE OR REPLACE`).

**Deploy:** apply `20260610174000_kts_invoice_import_rpc_v3.sql` after v2 (or alongside if v2 was not yet deployed).

---

## File index

| Layer | File | PR4.1.1 patient_id |
|-------|------|-------------------|
| RPC v1 | `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql` | No writeback |
| RPC v2 | `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql` | COALESCE writeback (can clobber) |
| RPC v3 | `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql` | Null-only / no-clobber; client master backfill |
| Service type + mapping | `src/features/kts/kts.service.ts` | Implemented (no change for v3) |
| Mutation hook | `src/features/kts/hooks/use-kts-invoice-import.ts` | Pass-through only |
| Commit mapping | `src/features/kts/hooks/use-kts-csv-import.ts` | v3: matched-only patientId gate |
| Dialog UI | `src/features/kts/components/kts-csv-import-dialog.tsx` | Delegates to hook |
| Preview types + matching | `src/features/kts/lib/kts-csv-import-utils.ts` | Implemented (no change for v3) |
