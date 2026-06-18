# KTS patient ID backfill audit

Read-only audit of the KTS accountant CSV import flow and where Schein-ID (`kts_patient_id`) is stored, matched, and written back. Scope: trip snapshot vs client master, matching certainty, uniqueness, and the safest place to extend backfill logic.

**Audit date:** 2026-06-10

No code or schema changes.

---

## 1. End-to-end KTS CSV import flow (today)

### Entry point

| Step | Location | What happens |
|------|----------|--------------|
| 1 | `src/app/dashboard/kts/kts-header.tsx` | **CSV importieren** opens `KtsCsvImportDialog` |
| 2 | `src/features/kts/components/kts-csv-import-dialog.tsx` | `handleCsvUpload`: Papa Parse with `encoding: 'windows-1252'`, `validateKtsAccountantCsvHeaders`, `parseKtsCsvRows`, re-encode UTF-8 file → `onFileDrop` |
| 3 | `src/features/kts/hooks/use-kts-csv-import.ts` | `onFileDrop`: Papa Parse again (`;` delimiter), validate headers, `parseKtsCsvRows`, set `pendingCsvRows`, `step = 'loading'`, enable candidate fetch |
| 4 | `src/features/kts/hooks/use-kts-invoice-import.ts` | `useFetchKtsCandidateTrips` → `fetchKtsCandidateTrips(supabase, companyId)` in `kts.service.ts` |
| 5 | `use-kts-csv-import.ts` `useEffect` | On candidates success: `matchKtsCsvRows(pendingCsvRows, data)` → preview buckets, pre-check matched rows, `step = 'reviewing'` |
| 6 | `kts-csv-import-dialog.tsx` | Admin reviews 4 buckets; toggles checkboxes on Zugeordnet + Niedrige Konfidenz |
| 7 | `use-kts-csv-import.ts` `onConfirm` | Builds `checkedRows`, maps to RPC payload incl. `patientId: row.patientId`, calls `useApplyKtsInvoiceImportMutation` |
| 8 | `kts.service.ts` `applyKtsInvoiceImport` | `supabase.rpc('apply_kts_invoice_import', { p_company_id, p_rows, p_source_filename })` |
| 9 | DB RPC | `apply_kts_invoice_import` (v2 if migration applied): insert `kts_external_invoices`, UPDATE eligible `trips` |
| 10 | `use-kts-invoice-import.ts` `onSuccess` | Invalidate `tripKeys.detail`, `tripKeys.all`, `ktsKpiKey`; optional RSC refresh |
| 11 | Dialog | `step = 'done'` — summary counts (stamped / skipped / unmatched) |

**No server actions, no `/api` route handlers, no Edge Functions** participate in this flow. Import is **browser Supabase client → RPC**.

### Required CSV columns

`kts-csv-import-utils.ts` — `Transportdatum`, `Patient`, `Belegnummer`, `Gesamtpreis`, `Eigenanteil`.

### Persistence touched on commit

| Table | Written? | Columns |
|-------|----------|---------|
| `kts_external_invoices` | Yes (INSERT) | batch metadata |
| `trips` | Yes (UPDATE) | `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, `kts_external_invoice_id`, `kts_status = abgerechnet`, `kts_patient_id` (v2 RPC only) |
| `clients` | **No** | — |

Trips with `kts_belegnummer IS NOT NULL` are skipped (RPC skip-not-fail; preview **Bereits importiert** bucket).

---

## 2. Tables and columns for patient IDs

There is **no** separate `patients` table. KTS uses `clients` (Fahrgast master) + `trips` (operational snapshot).

| Concept | Table | Column | Role (schema comments + `docs/kts-architecture.md` §3.0) |
|---------|-------|--------|----------------------------------------------------------|
| CSV Schein-ID | — (parsed only) | — | Extracted from CSV `Patient` field trailing `(digits)` via `normalizeCsvPatientName` → preview `patientId` |
| Client / patient master ID | `public.clients` | `kts_patient_id` | **Master** — edited in `ClientForm`; “external KTS patient ID from accountant billing system” |
| Trip-level snapshot ID | `public.trips` | `kts_patient_id` | **Snapshot** — stable for PR4 CSV matching; copied at KTS enable / client link; **not cleared** when KTS OFF |
| RPC payload field | JSON row in `p_rows` | `patient_id` | Maps from app `patientId`; written to `trips.kts_patient_id` in v2 RPC |

Migration: `supabase/migrations/20260610130000_kts_patient_id.sql`.

**Matching reads `trips.kts_patient_id` only** — not `clients.kts_patient_id` (see §3).

---

## 3. Matching logic — location and decision order

**File:** `src/features/kts/lib/kts-csv-import-utils.ts` — `matchKtsCsvRows` → `matchSingleRow`.

**Candidate pool:** `fetchKtsCandidateTrips` — all company trips with `kts_document_applies = true`, embed `clients(first_name, last_name)` for display names only.

### Decision order per CSV row

```
parseGermanDate(Transportdatum) → transportYmd
normalizeCsvPatientName(Patient) → { normalized, scheinId }

dateCandidates = trips on Berlin ymd(scheduled_at) excluding consumedTripIds

── Step 1: Schein-ID (trips.kts_patient_id) ──
IF scheinId present:
  idMatches = dateCandidates WHERE trip.kts_patient_id = scheinId
  IF idMatches.length > 0:
    → matched OR lowConfidence (if >1 trip, different belegnummer)
    RETURN

── Step 2: Name (no client-table match) ──
IF dateCandidates empty → unmatched

FOR each trip in dateCandidates:
  display = tripDisplayName(trip)
    IF client_id AND clients → clientDisplayNameFromParts(first, last)
    ELSE → trip.client_name
  IF normalize(display) === normalize(CSV normalized) → exactMatches
  ELIF hasPartialNameMatch → partialMatches

IF exactMatches > 1 AND different belegnummer → lowConfidence (claim earliest)
IF exactMatches >= 1 → matched (claim earliest)
IF partialMatches >= 1 → lowConfidence (claim earliest)
ELSE → unmatched
```

**Step 3 (address / lastname-only):** **Not implemented.** Cascade ends at partial token overlap.

### Trip vs client matching

| | Trip matching | Client matching |
|--|---------------|-----------------|
| Used in import? | **Yes** — entire cascade operates on `KtsCandidateTrip[]` | **No** — `clients` embed is only for `tripDisplayName` when `client_id` is set |
| ID field used | `trips.kts_patient_id` | Never queried in import |
| Same logic? | N/A — there is no separate client/patient resolution path |

---

## 4. Name-match commit — what is updated today

When a CSV row matched **by name** (Step 2) is approved and committed:

### Updated (v2 RPC applied)

On `trips` row (by `trip_id`):

```sql
kts_belegnummer, kts_invoice_amount, kts_eigenanteil,
kts_external_invoice_id, kts_status = 'abgerechnet',
kts_patient_id = COALESCE(NULLIF(btrim(r.patient_id), ''), t.kts_patient_id)
```

Plus one `kts_external_invoices` batch row.

### Not updated

- `clients.kts_patient_id` — **never** touched by import RPC
- `trips.client_id`, `trips.client_name` — unchanged
- Any other client master fields

### App payload

`use-kts-csv-import.ts` sends `patientId: row.patientId` for **every checked row** (matched **and** low-confidence if admin opted in):

```typescript
rows: checkedRows.map((row) => ({
  tripId: row.tripId!,
  belegnummer: row.belegnummer,
  invoiceAmount: row.gesamtpreis,
  eigenanteil: row.eigenanteil,
  patientId: row.patientId  // from normalizeCsvPatientName → buildPreviewRow
})),
```

`patientId` is populated on **all** preview rows from CSV Schein-ID (including unmatched), not only name-match rows.

---

## 5. Where should the missing ID be written? (schema meaning)

Per `docs/kts-architecture.md` §3.0:

| Store | Intended role |
|-------|---------------|
| `clients.kts_patient_id` | **Master** — profile edit surface (`ClientForm`) |
| `trips.kts_patient_id` | **Snapshot** — used for **PR4 CSV Step 1 matching** without live joins |

**Import matching uses the trip snapshot**, not the client master.

**Current writeback (PR4.1.1 v2):** **Trip snapshot only.**

**Conditionally both?** Architecture implies:

1. **Trip snapshot** — required for next import Step 1 (primary operational goal).
2. **Client master** — desirable for profile consistency when `trips.client_id` is set and master ID is empty; **not implemented** today. `ClientForm` description says ID “wird automatisch auf Fahrten übernommen” (client → trip), not the reverse.

**Recommended semantic order for a complete backfill:**

1. Backfill `trips.kts_patient_id` when null (enables Step 1 on this trip).
2. Optionally backfill `clients.kts_patient_id` when `trips.client_id` is set and client master is null (profile hygiene only).

---

## 6. Uniqueness guarantees for `kts_patient_id`

| Mechanism | `clients.kts_patient_id` | `trips.kts_patient_id` |
|-----------|--------------------------|------------------------|
| UNIQUE constraint | **None** | **None** |
| Partial unique index | **None** | **None** |
| Non-unique index | **None** | `idx_trips_company_kts_patient_id` on `(company_id, kts_patient_id)` WHERE `kts_document_applies AND kts_patient_id IS NOT NULL` (lookup only) |
| App duplicate checks | **None** in import path | **None** in import path |
| Nulls allowed | **Yes** (`text`, nullable) | **Yes** (`text`, nullable) |

**Conclusion:** Duplicate Schein-IDs across trips or clients are **allowed** at DB level. Step 1 matching with multiple trips on same date + same ID → **lowConfidence** bucket (or matched if same belegnummer state).

---

## 7. Multiple name candidates and wrong-ID prevention

### Can name matching produce multiple candidates?

**Yes** — `exactMatches` or `partialMatches` can contain multiple trips on the same Berlin date.

### Ambiguity handling (client-side)

| Situation | Bucket | Admin gate |
|-----------|--------|------------|
| Multiple exact, different `kts_belegnummer` | Niedrige Konfidenz | Unchecked by default; admin must opt in |
| Multiple exact, same beleg state | Zugeordnet | Pre-checked; **claim-one** (earliest `scheduled_at`) |
| Single partial token overlap | Niedrige Konfidenz | Unchecked by default |
| Multiple partial | Niedrige Konfidenz | Unchecked by default |
| `consumedTripIds` | Cross-row | Prevents same trip claimed by two CSV lines |

### What prevents wrong patient ID on wrong record?

| Guard | v2 | v3 (shipped) |
|-------|-----|--------------|
| Admin preview + checkbox | Yes | Yes |
| Low-confidence not pre-checked | Yes | Yes |
| One trip per CSV row (`consumedTripIds`) | Yes | Yes |
| RPC rejects wrong company / non-KTS | Yes | Yes |
| RPC only backfills when trip `kts_patient_id` IS NULL | **No** | **Yes** — guarded `CASE` |
| RPC never overwrites existing ID with **different** CSV value | **No** | **Yes** — no-clobber CASE branch |
| Block `patientId` on low-confidence commits | **No** | **Yes** — app-layer gate in `use-kts-csv-import.ts` |
| Client master backfill when linked + empty | **No** | **Yes** — `UPDATE clients` in same transaction |
| DB uniqueness | No | No (product decision; not required for backfill) |

### RPC v2 `kts_patient_id` expression (gap — fixed in v3)

```sql
-- v2 (gap): could overwrite existing trip ID with different CSV value
kts_patient_id = COALESCE(
  NULLIF(btrim(r.patient_id::text), ''),
  t.kts_patient_id
)
```

- Empty CSV `patient_id` → keeps existing trip ID ✓
- **Non-empty CSV `patient_id` → always uses CSV value**, even if trip already has a **different** non-null ID ✗

Docs (`kts-architecture.md` §3.7) stated writeback happened “when trip has no existing patient ID”; the v2 SQL did not enforce that. **Fixed in v3** (migration `20260610174000`).

### RPC v3 `kts_patient_id` expression (shipped)

```sql
-- v3: null-only / no-clobber; btrim normalization on both sides
kts_patient_id = CASE
  WHEN NULLIF(btrim(r.patient_id::text), '') IS NULL
    THEN t.kts_patient_id
  WHEN NULLIF(btrim(t.kts_patient_id::text), '') IS NULL
    THEN NULLIF(btrim(r.patient_id::text), '')
  WHEN btrim(t.kts_patient_id::text) = btrim(r.patient_id::text)
    THEN t.kts_patient_id
  ELSE t.kts_patient_id
END
```

Client master UPDATE in same transaction (v3 only):

```sql
UPDATE public.clients c
SET kts_patient_id = NULLIF(btrim(r.patient_id::text), '')
FROM public.trips t, jsonb_to_recordset(p_rows) AS r(...)
WHERE c.id = t.client_id
  AND t.id = r.trip_id
  AND t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND t.kts_belegnummer IS NULL
  AND t.client_id IS NOT NULL
  AND NULLIF(btrim(c.kts_patient_id::text), '') IS NULL   -- no-clobber via WHERE
  AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL;
```

---

## 8. Smallest safe implementation surface

### Options evaluated

| Location | Pros | Cons |
|----------|------|------|
| Row normalization (`normalizeCsvPatientName`) | Already extracts Schein-ID | No DB context; cannot know if backfill is safe |
| Match resolution (`matchKtsCsvRows`) | Knows confidence bucket | Preview-only; commit can diverge if payload not gated |
| App persistence (`applyKtsInvoiceImport` / hook) | Can omit `patientId` for low-confidence | Race-prone without DB guard; split brain vs RPC |
| **RPC / Postgres commit** | Atomic with invoice stamp; single source of truth; can join `trips` + `clients` safely | Requires migration |

### Recommendation: **RPC commit step** (extend `apply_kts_invoice_import` → v3)

**Why:**

1. Backfill is a **write** tied to invoice stamp — same transaction as `kts_belegnummer` / `abgerechnet`.
2. Safety rules need **current DB row state** (`t.kts_patient_id`, `clients.kts_patient_id`, `client_id`) — only reliable server-side.
3. PostgreSQL `UPDATE ... FROM jsonb_to_recordset` must ensure **one source row per target trip** (already 1:1 via `trip_id`); adding a conditional `clients` UPDATE in the same function avoids unpredictable multi-row joins.
4. Matches existing pattern (`create_kts_handover`, v2 import RPC).

**Minimal app-layer change:** Optionally pass `match_confidence: 'exact' | 'low'` per row, or only send `patient_id` for matched bucket — **defense in depth**, not sole guard.

**Do not** rely on upsert-on-conflict — there is no natural conflict key for “name-resolved trip + nullable ID”.

---

## 9. App-layer vs Postgres RPC

| Approach | Verdict |
|----------|---------|
| App-layer Supabase mutations (trip update + client update separately) | **Unsafe** — two round-trips; partial failure; TOCTOU between match preview and commit |
| **Postgres RPC (extend `apply_kts_invoice_import`)** | **Recommended** — same transaction as import stamp; tenant guards already present; COALESCE/CASE rules enforced once |

Aligns with `create_kts_handover` and PR4.1.1 v2 direction.

---

## 10. Required invariants (evaluate + recommend)

| Invariant | Current state | Required for safe backfill |
|-----------|---------------|----------------------------|
| CSV patient ID present and non-empty | Parsed to `patientId`; sent as `patient_id` | Keep; RPC should `NULLIF(btrim(...),'')` |
| Target trip `kts_patient_id` null/empty | **Not enforced** in RPC | `AND (t.kts_patient_id IS NULL OR btrim(t.kts_patient_id) = '')` before write, or `CASE` |
| Match unique + exact confidence | UI separates buckets; low-confidence opt-in | **RPC should not trust UI alone** — prefer app sends `patient_id` only for matched rows, or RPC receives confidence flag |
| Never overwrite non-null with **different** value | **Not enforced** | `CASE WHEN t.kts_patient_id IS NOT NULL AND t.kts_patient_id <> r.patient_id THEN t.kts_patient_id ELSE ... END` or skip write + NOTICE |
| Same value re-import | Harmless | Allow idempotent set |
| Client master backfill | **Done (v3)** | `UPDATE clients` in same transaction when `t.client_id IS NOT NULL` AND `clients.kts_patient_id` empty AND same invariants |
| Low-confidence commit | Can write `patient_id` today | **Exclude** `patient_id` from RPC row or ignore in RPC when not exact |

---

## 11. Trips vs clients on import

| Entity | Created? | Updated on import? |
|--------|----------|-------------------|
| Trips | No | Yes — invoice + status + optional `kts_patient_id` |
| Clients | No | **No** |

Import does **not** create clients or link `client_id`. It only updates existing matched trips by `trip_id`.

**If client master backfill is added:** should run in the **same RPC transaction** after trip UPDATE, keyed off `trips.client_id`, with stricter null-only guard on `clients.kts_patient_id`.

---

## 12. Proposed implementation plan (do not implement yet)

### A. Migration — `apply_kts_invoice_import` v3

**File:** `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql` (suggested name)

Replace `kts_patient_id` assignment with null-only backfill, e.g.:

```sql
kts_patient_id = CASE
  WHEN NULLIF(btrim(r.patient_id::text), '') IS NULL THEN t.kts_patient_id
  WHEN NULLIF(btrim(t.kts_patient_id::text), '') IS NULL
    THEN NULLIF(btrim(r.patient_id::text), '')
  WHEN btrim(t.kts_patient_id::text) = btrim(r.patient_id::text)
    THEN t.kts_patient_id
  ELSE t.kts_patient_id  -- keep existing; do not overwrite with different ID
END
```

Optional second statement in same function:

```sql
UPDATE clients c
SET kts_patient_id = ...
FROM trips t
JOIN jsonb_to_recordset(p_rows) r ON t.id = r.trip_id
WHERE c.id = t.client_id
  AND t.company_id = p_company_id
  AND NULLIF(btrim(c.kts_patient_id::text), '') IS NULL
  AND NULLIF(btrim(r.patient_id::text), '') IS NOT NULL
  -- same non-overwrite rules
```

Ensure each `trip_id` appears once in `p_rows` (app already sends one row per checked preview).

### B. App layer

| File | Change |
|------|--------|
| `use-kts-csv-import.ts` | Send `patientId` only for `matched` bucket rows (not low-confidence), unless product explicitly wants admin-opt-in low-confidence backfill |
| `kts.service.ts` | Optional `matchConfidence` on payload row; map to RPC |
| `kts-csv-import-utils.ts` | No change required for backfill logic (already sets `patientId` from CSV) |
| `docs/kts-architecture.md` §3.7 | Align RPC semantics with null-only backfill + optional client master |

### C. Transaction strategy

Single `apply_kts_invoice_import` RPC:

1. Validate rows (existing loop)
2. INSERT `kts_external_invoices`
3. UPDATE `trips` (invoice stamp + guarded `kts_patient_id`)
4. Optional UPDATE `clients` (master backfill)
5. RETURN `import_id`

### D. Duplicate / conflict protection

- **DB:** Consider **partial unique index** on `(company_id, kts_patient_id)` for trips WHERE `kts_document_applies` — **product decision** (may block legitimate duplicates); not required for minimal backfill.
- **RPC:** Never overwrite non-null conflicting IDs (§10).
- **UI:** Keep low-confidence unchecked; do not send `patient_id` for that bucket.

### E. Test cases

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Name match, trip `kts_patient_id` NULL, CSV has Schein-ID | Trip ID backfilled; import stamp succeeds |
| 2 | Step 1 match next import | Same trip matches on ID + date |
| 3 | Trip already has ID `123`, CSV sends `456` | Trip keeps `123`; invoice still stamps |
| 4 | Trip NULL, CSV empty `patient_id` | Trip stays NULL |
| 5 | Low-confidence row checked with `patient_id` | Per product: ignore in RPC or reject |
| 6 | Linked client, both IDs NULL | Trip + optional client master backfill |
| 7 | Linked client master has ID, trip NULL | Trip backfill only; client unchanged |
| 8 | Two trips same name/date | Claim-one preview; no cross-row duplicate stamp |
| 9 | v1 RPC (no migration) | No `kts_patient_id` write — deploy gate test |

### F. Docs to update

- `docs/kts-architecture.md` §3.0, §3.7 — correct RPC COALESCE description vs null-only intent
- `docs/plans/pr4.1.1-audit.md` — note v3 hardening if shipped
- `docs/plans/kts-patient-id-backfill-audit.md` — this file (status after implementation)

---

## 13. Current PR4.1.1 status (context)

Per `docs/plans/pr4.1.1-audit.md`:

| Layer | Status |
|-------|--------|
| v2 migration file | In repo |
| v3 migration file | **In repo** (`20260610174000_kts_invoice_import_rpc_v3.sql`) |
| App `patientId` payload | Implemented |
| App matched-only gate | **Implemented** (v3: `use-kts-csv-import.ts`) |
| Trip writeback — null-only / no-clobber | **Implemented** (v3 RPC) |
| Client master writeback when linked + empty | **Implemented** (v3 RPC) |
| Deploy v3 to Supabase | Operational — apply `20260610174000` per environment |

**Hardening complete.** Trip and client master backfill are now safe and atomic.

---

## 14. Senior recommendation

### Should this be built now?

**Yes — as hardening, not greenfield.** PR4.1.1 v2 already writes `trips.kts_patient_id` on commit, but:

1. RPC can **overwrite** an existing trip ID with a different CSV value (unsafe).
2. **Client master** is never backfilled.
3. **Low-confidence** rows can pass `patient_id` if admin checks them.
4. v2 migration may not be **deployed** on all environments.

Building **v3 RPC guards** + **app payload gating** is small, high-leverage, and closes false-backfill risk before more CSV volume.

### Safest write location

**`apply_kts_invoice_import` RPC (v3)** — conditional `trips.kts_patient_id` UPDATE in the existing commit transaction; optional `clients.kts_patient_id` UPDATE joined via `trips.client_id`.

### Exact guardrails

1. **Write `trips.kts_patient_id` only when** `NULLIF(btrim(t.kts_patient_id),'') IS NULL` **and** CSV `patient_id` is non-empty.
2. **Never overwrite** non-null trip ID with a different CSV value (keep existing; optionally `RAISE NOTICE`).
3. **Send / honor `patient_id` only for Zugeordnet (exact) matches** — not Niedrige Konfidenz unless product explicitly accepts admin risk.
4. **Client master:** update only when `client_id` set and `clients.kts_patient_id` null, same non-overwrite rules.
5. **One `trip_id` per RPC row** — preserve 1:1 `UPDATE ... FROM` join (PostgreSQL safety).
6. **Deploy v2/v3 before relying on backfill** in production.
7. **Do not add upsert-on-conflict** without a product decision on company-wide Schein-ID uniqueness.

### What not to do

- Backfill in `normalizeCsvPatientName` or match utils (no DB state).
- Split trip + client updates across separate client mutations (non-atomic).
- Blind `COALESCE(csv, existing)` for ID fields (current v2 gap).

---

## File index

| Concern | Path |
|---------|------|
| Import entry | `src/app/dashboard/kts/kts-header.tsx` |
| Dialog | `src/features/kts/components/kts-csv-import-dialog.tsx` |
| Orchestration | `src/features/kts/hooks/use-kts-csv-import.ts` |
| Fetch + mutation hooks | `src/features/kts/hooks/use-kts-invoice-import.ts` |
| Service / RPC wrapper | `src/features/kts/kts.service.ts` |
| Matching | `src/features/kts/lib/kts-csv-import-utils.ts` |
| Trip ID inline edit | `src/features/kts/components/kts-table/kts-patient-id-cell.tsx` |
| Client master ID | `src/features/clients/components/client-form.tsx` |
| Schema | `supabase/migrations/20260610130000_kts_patient_id.sql` |
| Import RPC v1 | `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql` |
| Import RPC v2 (COALESCE writeback — gap) | `supabase/migrations/20260610173000_kts_invoice_import_rpc_v2.sql` |
| Import RPC v3 (null-only / no-clobber; client master) | `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql` |
| Architecture | `docs/kts-architecture.md` |
| PR4.1.1 layer audit | `docs/plans/pr4.1.1-audit.md` |
