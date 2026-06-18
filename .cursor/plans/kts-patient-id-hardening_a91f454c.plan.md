---
name: kts-patient-id-hardening
overview: Harden KTS CSV import patient-id backfill to be null-only and no-clobber at the RPC layer for both trips.kts_patient_id and clients.kts_patient_id (when linked and empty), plus app-layer payload gating so low-confidence rows don’t send patientId by default. Keep scope surgical and avoid matching/preview behavior changes.
todos:
  - id: rpc-v3-hardening
    content: Add v3 migration with guarded trips.kts_patient_id CASE (btrim-normalized), plus clients.kts_patient_id backfill in same transaction when client_id linked and master empty; verify signature, return type, SECURITY DEFINER, grants, and all non-body properties match v2.
    status: completed
  - id: app-payload-gating
    content: Gate outgoing patientId in use-kts-csv-import.ts so only matched bucket rows send it; low-confidence rows send null/omit. Add inline why comment on the gate.
    status: completed
  - id: docs-align
    content: Update docs/kts-architecture.md, pr4.1.1-audit.md, and kts-patient-id-backfill-audit.md for v3 trip + client semantics; add inline why comments to every new/changed non-obvious code path.
    status: completed
  - id: verify-build
    content: Run bun run build and manual smoke checklist (trip + client backfill, no-clobber, whitespace, low-confidence) after changes.
    status: completed
isProject: false
---

# KTS CSV patient-id hardening (v3)

## Goal

Make KTS accountant CSV import patient-id backfill **safe and deterministic**:

- **Trip snapshot (primary):** backfill `trips.kts_patient_id` only when the trip currently has no patient ID
- **Client master (same transaction):** when the matched trip has `client_id` and `clients.kts_patient_id` is empty, backfill the client master with the same CSV Schein-ID
- **Null-only / no-clobber (both targets):** empty CSV ID → no write; same ID → keep (idempotent); different non-empty ID → keep existing; never clear an existing value
- **Defense-in-depth:** low-confidence rows must not send `patientId` by default

## Constraints to preserve

- Do **not** change matching order or preview bucket logic in [`src/features/kts/lib/kts-csv-import-utils.ts`](src/features/kts/lib/kts-csv-import-utils.ts)
- Do **not** add uniqueness constraints or indexes for `kts_patient_id`
- Do **not** change any UI outside the KTS import flow
- Do **not** refactor unrelated KTS code
- No magic numbers
- No partial implementation — existing invoice-stamp behavior must remain functionally identical except for the new safe backfill behavior

## Implementation steps

### 1) Harden the RPC (migration v3)

**File:** `supabase/migrations/<NEW>_kts_invoice_import_rpc_v3.sql` (does not exist yet — create new)

**RPC parity with v2 (verify, do not assume):** `CREATE OR REPLACE` preserves function identity, but the migration must explicitly preserve all non-body properties from [`supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql`](supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql) unless a compile/runtime issue forces a narrower change (document why in the migration comment):

- **Signature:** `(p_company_id uuid, p_rows jsonb, p_handover_id uuid DEFAULT NULL, p_source_filename text DEFAULT NULL)`
- **Return type:** `uuid`
- **Language / security:** `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`
- **Grants:** `REVOKE ALL … FROM PUBLIC`; `GRANT EXECUTE … TO authenticated`
- **Validation loop / INSERT / trip UPDATE WHERE clauses:** unchanged except `kts_patient_id` assignment and the new `clients` UPDATE block
- **Comment:** update `COMMENT ON FUNCTION` to describe v3 null-only/no-clobber semantics for **both** trip and client writes

Before shipping, diff v3 against v2 line-by-line and confirm only the intended patient-ID blocks and comment differ.

#### 1a) Trip write — replace v2 COALESCE

Replace:

```sql
kts_patient_id = COALESCE(NULLIF(btrim(r.patient_id::text), ''), t.kts_patient_id)
```

with a guarded `CASE` using **btrim-normalized** forms for empty checks and equality:

```sql
-- Pseudocode — derive once per row in SET expression or inline
csv_id  := NULLIF(btrim(r.patient_id::text), '');
trip_id := NULLIF(btrim(t.kts_patient_id::text), '');
-- empty csv_id        → keep t.kts_patient_id
-- empty trip_id       → set to csv_id
-- trip_id = csv_id    → keep (idempotent; whitespace-only differences are "same")
-- else                → keep t.kts_patient_id (no-clobber)
```

Add an inline `-- why:` comment explaining null-only / no-clobber / btrim normalization.

#### 1b) Client master write — same transaction, after trip UPDATE

Add a second `UPDATE` in the same function body (still atomic — single RPC = single transaction):

```sql
UPDATE public.clients c
SET kts_patient_id = <same CASE pattern using csv_id and client_id trimmed>
FROM public.trips t
JOIN jsonb_to_recordset(p_rows) AS r(...) ON t.id = r.trip_id
WHERE c.id = t.client_id
  AND c.company_id = p_company_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL   -- same eligible rows as trip stamp
  AND t.client_id IS NOT NULL
  AND NULLIF(btrim(c.kts_patient_id::text), '') IS NULL  -- master currently empty
  AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL -- CSV provides ID
```

Client `SET` expression uses the **same null-only / no-clobber / btrim rules** as trips:

- **Clarified guard:** because the `WHERE` clause includes `NULLIF(btrim(c.kts_patient_id::text), '') IS NULL`, this statement is explicitly **\"client master empty only\"**. That means client no-clobber is enforced primarily by the `WHERE` filter (we never target non-empty client rows), plus safe SET logic as defense-in-depth.
- empty CSV → no write (WHERE already filters; SET should still be safe)
- empty client master → set to CSV id

Add inline `-- why:` comment: client master backfill keeps profile consistent when trip is linked and master was never set; trip snapshot remains primary matching target.

**Import semantics unchanged:**

- `kts_belegnummer IS NULL` guard on trip UPDATE (and mirrored on client UPDATE join)
- `kts_document_applies = true` guard
- skip-not-fail via `v_stamped_count` + validation loop — client UPDATE must only touch trips that are actually being stamped in this batch (not skipped-already-imported rows)

**Do not widen the RPC signature** — client backfill is derived from `trips.client_id` + existing `patient_id` payload field; no new JSON keys required.

### 2) App-layer payload gating for low-confidence

In [`src/features/kts/hooks/use-kts-csv-import.ts`](src/features/kts/hooks/use-kts-csv-import.ts), adjust `onConfirm` commit mapping:

- Build a `Set` of matched `rowKey`s from `matchResult.matched`
- Send `patientId: row.patientId` **only** when `row.rowKey` is in that set
- Low-confidence checked rows: send `patientId: null` (or omit — `kts.service.ts` maps to `null`)

Current location (lines 196–205):

```ts
patientId: row.patientId  // today: all checked rows
```

Replace with conditional + inline `-- why:` comment: low-confidence matches are ambiguous; RPC hardening is defense-in-depth but app must not send Schein-ID for non-exact buckets by default.

**Do not change** [`src/features/kts/kts.service.ts`](src/features/kts/kts.service.ts) unless compile forces it — `ApplyKtsInvoiceImportPayload` already supports `patientId?: string | null` and maps `patient_id: row.patientId ?? null`.

### 3) Documentation updates (mandatory)

Update all relevant docs under `docs/`:

| File | Changes |
|------|---------|
| [`docs/kts-architecture.md`](docs/kts-architecture.md) §3.0, §3.7 | Trip backfill; client-master backfill when linked + empty; null-only/no-clobber; v3 migration reference; correct v2 COALESCE inaccuracy |
| [`docs/plans/pr4.1.1-audit.md`](docs/plans/pr4.1.1-audit.md) | v2 was incomplete (could clobber conflicting trip IDs, no client write); v3 hardens both |
| [`docs/plans/kts-patient-id-backfill-audit.md`](docs/plans/kts-patient-id-backfill-audit.md) | Status + invariant sections: client master now in same transaction; mark hardening implemented after ship |

### 4) Inline why comments (mandatory, non-negotiable)

Every **new or changed non-obvious code path** must include a `-- why:` (SQL) or `// why:` (TS) comment explaining the business rule:

- v3 migration: trip CASE, client UPDATE block, btrim normalization
- `use-kts-csv-import.ts`: matched-only `patientId` gate

Obvious boilerplate (imports, type re-exports) does not need comments.

### 5) Verification

- **Build gate:** `bun run build`
- **Manual smoke:**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Trip `kts_patient_id` NULL, CSV Schein-ID, matched row | Trip backfilled |
| 2 | Same as 1 + `client_id` set, client master NULL | Trip **and** client master backfilled |
| 3 | Re-import same row, same id | Both unchanged (idempotent) |
| 4 | Trip has id `A`, CSV sends `B` | Trip stays `A`; client unchanged if it had a value |
| 5 | Trip `kts_patient_id = '123 '` (spaces), CSV `'123'` | Treated as same; no overwrite |
| 6 | Linked client master already has id, trip NULL | Trip backfill only; client unchanged |
| 7 | Low-confidence row checked | Invoice stamp applies; trip + client IDs unchanged (app omits `patientId`; RPC guards) |
| 8 | Trip NULL, CSV empty `patient_id` | Trip and client stay NULL |

## Invariants after implementation

1. A CSV patient ID is saved to `trips.kts_patient_id` when the matched trip has no patient ID and the row is eligible for stamp.
2. If that trip is linked to a client and `clients.kts_patient_id` is empty, the same patient ID is saved to the client master in the **same RPC transaction**.
3. Existing different IDs are never overwritten on either table.
4. Low-confidence rows do not backfill by default (app omits `patientId`; RPC null-only guards remain).
5. Invoice stamping behavior (`kts_belegnummer`, amounts, status, skip-not-fail) is unchanged.

## Files expected to change

- `supabase/migrations/<NEW>_kts_invoice_import_rpc_v3.sql` (new)
- [`src/features/kts/hooks/use-kts-csv-import.ts`](src/features/kts/hooks/use-kts-csv-import.ts)
- [`docs/kts-architecture.md`](docs/kts-architecture.md)
- [`docs/plans/pr4.1.1-audit.md`](docs/plans/pr4.1.1-audit.md)
- [`docs/plans/kts-patient-id-backfill-audit.md`](docs/plans/kts-patient-id-backfill-audit.md)

**Likely no change:** [`src/features/kts/kts.service.ts`](src/features/kts/kts.service.ts), [`src/features/kts/lib/kts-csv-import-utils.ts`](src/features/kts/lib/kts-csv-import-utils.ts)

## Non-goals (explicit)

- No changes to matching logic/buckets in `kts-csv-import-utils.ts`
- No uniqueness/index changes for `kts_patient_id`
- No UI changes outside KTS import flow
- No unrelated KTS refactors
- This is hardening, not a product rewrite
