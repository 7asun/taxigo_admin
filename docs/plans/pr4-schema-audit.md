# PR4 — Schema design audit (accountant CSV import)

**Date:** 2026-06-10  
**Scope:** Read-only schema design audit for PR4 — accountant CSV import into the KTS module.  
**Constraint:** No code changes, no migrations in this document — recommendations only.

**Files read:**

- All KTS migrations `20260610120000` through `20260610160000`
- `src/types/database.types.ts` (kts / trips / clients / handover / corrections)
- `src/features/kts/kts.service.ts`, `use-kts-status.ts`, `kts-listing-page.tsx`, `kts-trip-row.ts`
- `src/lib/kts-status.ts`, `kts-kpi-section.tsx`, `kts-actions-cell.tsx`
- `docs/kts-architecture.md`
- `docs/plans/kts-module-b-patient-id-audit.md`
- `docs/plans/pr4-csv-import-audit.md`
- Bank reconciliation prior art (`match-invoices.ts`)

---

## End-to-end flow (context)

```
ungeprueft → korrekt → (handover) → uebergeben → (CSV import) → abgerechnet
                      ↑                    ↑                           ↑
              kts_handovers         trips.kts_handover_id      kts_external_invoices
                                    (PR3.3)                    + trip invoice fields (PR4)
```

---

## 1. Current `kts_status` enum — full flow

### Enum definition (migration `20260610140000_kts_status.sql`)

```sql
CREATE TYPE public.kts_status AS ENUM (
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben'
);
```

TypeScript mirror (`database.types.ts` lines 2223–2228):

```typescript
      kts_status:
        | 'ungeprueft'
        | 'korrekt'
        | 'fehlerhaft'
        | 'in_korrektur'
        | 'uebergeben';
```

### Business meaning (from architecture §3.4 + service JSDoc)

| Value | Meaning | Typical next actions |
| ----- | ------- | -------------------- |
| `ungeprueft` | Paper not checked, or returned awaiting re-check | `markKtsChecked`, `markKtsFehlerhaft` |
| `korrekt` | Verified clean — ready for handover | Handover (PR3.3), re-open error |
| `fehlerhaft` | Error recorded, not yet sent | `sendKtsCorrection`, `clearKtsMistake` |
| `in_korrektur` | Paper with issuer | `receiveKtsCorrection` |
| `uebergeben` | Handed to accountant (PR3.3 terminal **for queue actions**) | CSV import → `abgerechnet` (PR4) |
| `NULL` | KTS not applicable | — |

### Where `uebergeben` is treated as terminal today

**Actions cell** — no buttons, dash only (`kts-actions-cell.tsx` lines 79–82):

```tsx
  if (status === 'uebergeben') {
    return (
      <span className='text-muted-foreground text-xs'>—</span>
    );
  }
```

**Handover RPC** — sets terminal handover state (`20260610160000_kts_handovers.sql` lines 109–113):

```sql
  UPDATE public.trips
  SET
    kts_status       = 'uebergeben',
    kts_handover_id  = v_handover_id,
    kts_fehler       = false
```

**KPI RPC** — `uebergeben` is **not** broken out; it counts toward `gesamt` only (`20260610150000_kts_queue_kpis.sql` lines 24–28):

```sql
    (COUNT(*) FILTER (WHERE true))::bigint AS gesamt,
    (COUNT(*) FILTER (WHERE t.kts_status = 'ungeprueft'))::bigint AS ungeprueft,
    (COUNT(*) FILTER (
      WHERE t.kts_status IN ('fehlerhaft', 'in_korrektur')
    ))::bigint AS fehler_aktiv,
```

**Default list filter** — `kts-filters-bar.tsx` defaults to `kts_status=ungeprueft` on first visit — `uebergeben` rows hidden unless admin selects that filter.

**Badge styling** — muted/disabled appearance (`kts-status.ts` lines 22–23):

```typescript
        uebergeben:
          'bg-muted/50 text-muted-foreground border-border opacity-70'
```

### Will `abgerechnet` break exhaustive checks?

**Yes — TypeScript will fail until updated.** Places that must add the new value:

| Location | Pattern | Break? |
| -------- | ------- | ------ |
| `src/lib/kts-status.ts` | `Record<KtsStatus, string>` (`KTS_STATUS_LABELS`) | **Yes** — compile error |
| `src/lib/kts-status.ts` | `ktsStatusBadge` cva `variants.status` | **Yes** — missing variant |
| `src/lib/kts-status.ts` | `KTS_STATUS_VALUES` array | Filter UI omits new status until updated |
| `src/lib/kts-status.ts` | `KTS_STATUS_DOT` in filters | Same |
| `kts-actions-cell.tsx` | Sequential `if (status === …)` | No exhaustiveness — needs new branch (terminal dash like `uebergeben`) |
| `database.types.ts` | Enum union | Manual regen after migration |
| KPI RPC / display | No per-status breakdown for `uebergeben` today | **No SQL break** — `abgerechnet` falls into `gesamt` only |
| `normalizeKtsPatch` rule C | `isKtsErrorStatus` only fehlerhaft/in_korrektur | **No break** — `abgerechnet` → `kts_fehler: false` |

**Naming:** `abgerechnet` fits the German UI ("an Buchhaltung übergeben" → accountant billed). Alternative `abgerechnet` vs `fakturiert` — `abgerechnet` aligns with product wording. It is **not** the final lifecycle state if PR5 adds Krankenkasse payment — consider reserving a later status (e.g. `bezahlt`) or payment flags on the import batch.

---

## 2. `kts_handovers` table — confirmed schema

Full `CREATE TABLE` from `20260610160000_kts_handovers.sql` (lines 4–12):

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

**Link to import batch:** **Absent.** No `kts_external_invoice_id` or similar on `kts_handovers`.

**Reverse link already exists on trips:**

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_handover_id uuid
  REFERENCES public.kts_handovers(id) ON DELETE SET NULL;
```

Audit loop closure: **trips** connect handover → import; **kts_external_invoices** should optionally reference a handover for admin context, not the other way around.

---

## 3. `trips` table — KTS columns full inventory

From `database.types.ts` `trips.Row` (KTS-related):

| Column | Type | Nullable | Notes |
| ------ | ---- | -------- | ----- |
| `kts_document_applies` | `boolean` | NOT NULL | Operational KTS flag |
| `kts_fehler` | `boolean` | NOT NULL | Synced from status (rule C) |
| `kts_fehler_beschreibung` | `string \| null` | yes | Error text |
| `kts_handover_id` | `string \| null` | yes | FK → `kts_handovers` (**exists**, PR3.3) |
| `kts_patient_id` | `string \| null` | yes | PR3 snapshot for CSV match |
| `kts_source` | `string \| null` | yes | Catalog vs manual |
| `kts_status` | `kts_status enum \| null` | yes | Workflow state |

**Confirmed absent (PR4):**

- `kts_belegnummer` — **no**
- `kts_invoice_amount` — **no**
- `kts_eigenanteil` — **no**
- `kts_external_invoice_id` — **no** (planned)

### Terminal handling on `uebergeben` (handover RPC)

On handover commit, trips receive:

```sql
    kts_status       = 'uebergeben',
    kts_handover_id  = v_handover_id,
    kts_fehler       = false
```

**Not cleared:** `kts_patient_id`, `kts_fehler_beschreibung` (beschreibung may remain but `kts_fehler` forced false), `kts_document_applies`, invoice fields (don't exist yet).

---

## 4. `kts_external_invoices` — DDL recommendation

Model after **`kts_handovers`** (append-only batch, minimal columns) + audit metadata for CSV imports.

### Recommended table

```sql
CREATE TABLE public.kts_external_invoices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL
                              REFERENCES public.companies(id)
                              ON DELETE CASCADE,
  kts_handover_id uuid        REFERENCES public.kts_handovers(id)
                              ON DELETE SET NULL,
  source_filename text,
  row_count       int         NOT NULL DEFAULT 0,
  matched_count   int         NOT NULL DEFAULT 0,
  skipped_count   int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES auth.users(id)
                              ON DELETE SET NULL
);
```

| Column | Rationale |
| ------ | --------- |
| `company_id` | Tenant scope — required on all KTS satellites |
| `kts_handover_id` | **Optional** audit link — "which handover this import was for" when admin selects one; NULL when CSV spans multiple handovers |
| `source_filename` | Display in import history; not parsed from DB |
| `row_count` / `matched_count` / `skipped_count` | Dashboard + audit without re-counting trips |
| `created_at` / `created_by` | Same as `kts_handovers` |

### FK choice: handover link

**Recommend optional nullable FK on `kts_external_invoices.kts_handover_id`** — not a junction table, not an array.

| Approach | Verdict |
| -------- | ------- |
| FK on import batch → handover | **Preferred** — documents admin intent; nullable handles multi-handover CSVs |
| Junction `kts_handover_invoice_links` | Overkill for v1 — one import row already groups N trips via `trips.kts_external_invoice_id` |
| Array of handover UUIDs on import | Harder to index/query; awkward in Postgres |
| FK on `kts_handovers` → import | Wrong direction — handover happens **before** CSV exists |

**Trip-level handover** remains `trips.kts_handover_id` (already shipped). Import batch handover FK is **hint/metadata**, not enforcement.

### New columns on `trips` (same migration)

```sql
ALTER TABLE public.trips
  ADD COLUMN kts_belegnummer text,
  ADD COLUMN kts_invoice_amount numeric(12, 2),
  ADD COLUMN kts_eigenanteil numeric(12, 2),
  ADD COLUMN kts_external_invoice_id uuid
    REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL;
```

Use `text` for `kts_belegnummer` (leading zeros, future alphanumeric). Amounts as `numeric(12,2)` — matches invoice/money columns elsewhere.

### Indexes

```sql
CREATE INDEX idx_kts_external_invoices_company_id
  ON public.kts_external_invoices (company_id);

CREATE INDEX idx_kts_external_invoices_company_created_at
  ON public.kts_external_invoices (company_id, created_at DESC);

CREATE INDEX idx_kts_external_invoices_handover_id
  ON public.kts_external_invoices (kts_handover_id)
  WHERE kts_handover_id IS NOT NULL;

CREATE INDEX idx_trips_company_kts_belegnummer
  ON public.trips (company_id, kts_belegnummer)
  WHERE kts_belegnummer IS NOT NULL;

CREATE INDEX idx_trips_kts_external_invoice_id
  ON public.trips (kts_external_invoice_id)
  WHERE kts_external_invoice_id IS NOT NULL;

-- Matching helper (PR4 preview RPC / name fallback)
CREATE INDEX idx_trips_company_kts_patient_id
  ON public.trips (company_id, kts_patient_id)
  WHERE kts_document_applies = true AND kts_patient_id IS NOT NULL;
```

**Do not** UNIQUE `(company_id, kts_belegnummer)` — same Belegnummer on multiple trips is **expected**.

### RLS (model: `kts_handovers`)

```sql
ALTER TABLE public.kts_external_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kts_external_invoices_select"
  ON public.kts_external_invoices FOR SELECT
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_external_invoices_insert"
  ON public.kts_external_invoices FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

-- Append-only: no UPDATE/DELETE policies (mirror kts_handovers)
GRANT SELECT, INSERT ON public.kts_external_invoices TO authenticated, service_role;
```

Trip invoice columns inherit existing trips RLS on UPDATE (via RPC SECURITY DEFINER, not direct client PATCH).

---

## 5. Commit RPC design — `apply_kts_invoice_import`

### Precedent: `create_kts_handover` (SECURITY DEFINER + guards)

From `20260610160000_kts_handovers.sql` (lines 81–83, 128–131):

```sql
  IF NOT public.current_user_is_admin()
     OR p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'create_kts_handover: unauthorized';
  END IF;
```

```sql
COMMENT ON FUNCTION public.create_kts_handover(uuid, uuid[]) IS
  'Atomic KTS handover batch (PR3.3): ... SECURITY DEFINER — tenant guard '
  'via current_user_is_admin() and p_company_id = current_user_company_id().';
```

### Recommended signature

```sql
CREATE OR REPLACE FUNCTION public.apply_kts_invoice_import(
  p_company_id      uuid,
  p_handover_id     uuid,          -- nullable: pass NULL when unknown / multi-handover
  p_rows            jsonb          -- array of commit objects
)
RETURNS TABLE (
  import_id         uuid,
  updated_count     int,
  skipped_count     int
)
```

**`p_rows` element shape:**

```json
{
  "trip_id": "uuid",
  "belegnummer": "261525",
  "invoice_amount": 36.00,
  "eigenanteil": 0.00
}
```

Preview/matching stays **outside** this RPC (client or separate dry-run RPC). Commit RPC trusts admin confirmation but **re-validates** eligibility server-side.

### Critical guards (inside RPC)

1. **Authorize:** `current_user_is_admin()` AND `p_company_id = current_user_company_id()` (same as handover/KPI).
2. **Reject empty** `p_rows` array.
3. **Optional handover FK:** if `p_handover_id IS NOT NULL`, verify row exists and `kts_handovers.company_id = p_company_id`.
4. **Per trip validation** (JOIN `trips t`):
   - `t.id = trip_id` from row
   - `t.company_id = p_company_id`
   - `t.kts_document_applies = true`
   - `t.kts_belegnummer IS NULL` — **re-import guard** (hard reject; preview "Bereits importiert" bucket)
   - `t.kts_status = 'uebergeben'` — **recommended hard requirement** for commit (product hint for non-uebergeben is preview-only; RPC enforces happy path)
5. **Row count verification** after UPDATE — mirror handover `GET DIAGNOSTICS` pattern.
6. **INSERT** one `kts_external_invoices` row first; then UPDATE trips with batch id.

### UPDATE trip set

```sql
UPDATE public.trips SET
  kts_belegnummer          = v_belegnummer,
  kts_invoice_amount       = v_invoice_amount,
  kts_eigenanteil          = v_eigenanteil,
  kts_external_invoice_id  = v_import_id,
  kts_status               = 'abgerechnet'
WHERE ...
```

### Return type

Return `import_id` + counts — sufficient for toast ("12 Belege importiert, 2 übersprungen").

### SECURITY DEFINER?

**Yes** — same class as `create_kts_handover` and `get_kts_queue_kpis`. Multi-row atomic write + enum transition; client must not PATCH trips directly for import.

### Optional companion RPC (preview)

```sql
-- Separate migration — not required for commit path
match_kts_invoice_import_candidates(
  p_company_id uuid,
  p_rows jsonb  -- parsed CSV rows, not trip IDs
) RETURNS jsonb
```

Server-side matching with Berlin date + `kts_patient_id` + optional `clients` join for name fallback — keeps rules out of duplicated client/server logic. **Defer to PR4.1 if preview matching in TypeScript is acceptable for v1.**

---

## 6. `kts_status` in KPI RPC

Full KPI SQL (`20260610150000_kts_queue_kpis.sql` lines 23–40):

```sql
  SELECT
    (COUNT(*) FILTER (WHERE true))::bigint AS gesamt,
    (COUNT(*) FILTER (WHERE t.kts_status = 'ungeprueft'))::bigint AS ungeprueft,
    (COUNT(*) FILTER (
      WHERE t.kts_status IN ('fehlerhaft', 'in_korrektur')
    ))::bigint AS fehler_aktiv,
    ( ... overdue subquery ... ) AS ueberfaellig
  FROM public.trips t
  WHERE t.company_id = p_company_id
    AND t.kts_document_applies = true
```

**Does not break down `korrekt`, `uebergeben`, or future `abgerechnet`.**

**KPI display** (`kts-kpi-section.tsx`) — four cards: Gesamt, Ungeprüft, Fehler aktiv, Überfällig. No card for übergeben/abgerechnet.

**Impact of `abgerechnet`:**

| Area | Change needed? |
| ---- | -------------- |
| KPI RPC SQL | **Optional** — `abgerechnet` trips remain in `gesamt`; excluded from `ungeprueft`/`fehler_aktiv` automatically |
| KPI UI | **Optional PR4+** — add "Abgerechnet" or "Offen bei Buchhaltung" (`uebergeben`) cards for controlling view (PR6) |
| Filter bar | Add `abgerechnet` to `KTS_STATUS_VALUES` + labels when enum extended |

---

## 7. Re-import detection — existing patterns

**No exact `kts_belegnummer` precedent.** Closest: **bank reconciliation `already_paid`**.

`match-invoices.ts` (lines 167–171):

```typescript
    if (lookupInvoice.status !== 'sent') {
      warningReasons.push('already_paid');
    }
```

Bucketed as `warning` — shown in review UI, excluded from ready confirm (`review-table.tsx` filters `already_paid`).

**Bulk upload:** No "already exists" trip detection before insert — creates new rows. Not applicable.

**PR4 pattern to adopt:**

- Preview: if `trip.kts_belegnummer IS NOT NULL` → bucket **`already_imported`** (separate from unmatched/ambiguous)
- Commit RPC: hard reject rows where `kts_belegnummer IS NOT NULL` — never silent overwrite
- Optional admin "force re-import" deferred to PR4.1 (would need audit row or null-out workflow)

---

## 8. Trips → clients join for name fallback

**KTS listing** (`kts-listing-page.tsx` lines 33–36):

```typescript
  const ktsListSelect = `
    *,
    kts_corrections(id, sent_at, received_at, sent_to)
  `;
```

**No `clients(...)` embed.** Name display uses `trips.client_name` snapshot (`kts-columns.tsx`).

**`kts.service.ts`:** No trip–client join queries.

**Trip detail** (outside KTS listing) uses `clients(*)` embed in `tripsService.getTripById` — not used by import path today.

### Safest name-fallback approach

**Dedicated server RPC or API for candidate fetch** — not in-app matching against listing data alone.

Recommended query shape (inside `match_kts_invoice_import_candidates` or API):

```sql
SELECT t.id, t.scheduled_at, t.kts_patient_id, t.kts_status, t.kts_belegnummer,
       t.client_name, t.client_id,
       c.first_name, c.last_name
FROM trips t
LEFT JOIN clients c ON c.id = t.client_id
WHERE t.company_id = p_company_id
  AND t.kts_document_applies = true
  AND (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date = p_transport_date
  AND ( ... patient_id OR name match predicates ... )
```

**Why server-side:**

- Berlin date predicate belongs in SQL (matches controlling RPCs)
- Name fallback needs `clients.first_name/last_name` — not in KTS list RSC
- Company scope + performance (indexed date/patient filters)
- Client-side preview can call dry-run endpoint after Papa Parse

**Fallback when `client_id IS NULL`:** parse `trips.client_name` heuristically (comma-separated "Nachname, Vorname") — lower confidence; flag ambiguous.

---

## 9. Existing status transition guards

**`kts.service.ts` does not runtime-validate current status before writes.** Guards are **JSDoc only**:

| Function | Documented valid from | Enforced in code? |
| -------- | --------------------- | ----------------- |
| `markKtsChecked` | `ungeprueft` | **No** — only sets `{ kts_status: 'korrekt' }` |
| `markKtsFehlerhaft` | `ungeprueft`, `korrekt` | **No** |
| `clearKtsMistake` | `fehlerhaft` | **No** |
| `sendKtsCorrection` | `fehlerhaft` | **No** — inserts correction + sets `in_korrektur` |
| `receiveKtsCorrection` | `in_korrektur` | **No** — closes round + `ungeprueft` |
| `createKtsHandover` (RPC) | `korrekt` | **Yes — DB** |

UI gates some paths (e.g. actions cell by status; handover checkbox korrekt-only), but service layer is permissive.

**Implication for `apply_kts_invoice_import`:** RPC **should** enforce eligibility strictly (unlike TS service functions) — multi-row financial write, same class as `create_kts_handover`.

---

## 10. Future-proofing — structural gaps

### Current model after PR4 (planned)

```
trips (flags + snapshot patient ID + invoice stamp columns)
  ├── kts_corrections (correction rounds)
  ├── kts_handovers (handover batches) ← trips.kts_handover_id
  └── kts_external_invoices (import batches) ← trips.kts_external_invoice_id
```

### PR6 — KTS dashboard / controlling

**Trip columns + import batch table are sufficient for v1 metrics:**

- Count by `kts_status` (including `abgerechnet`)
- Sum `kts_invoice_amount` / `kts_eigenanteil` grouped by status, handover, import batch
- Aging: `uebergeben` without import (`kts_belegnummer IS NULL`)

**Gap:** No single row representing **accountant Beleg** when one Belegnummer spans N trips — must `GROUP BY kts_belegnummer`. Acceptable for SQL/dashboard; add materialized view later if slow.

### PR5 — Krankenkasse payment matching

**Gap:** Trip stamp stores Belegnummer + amounts but **not payment state**. Bank reconciliation today matches **`invoices.invoice_number`**, not KTS Belegnummer.

**Will need (PR5):** either:

- Payment fields on `kts_external_invoices` (`payment_status`, `paid_at`, bank reference), or
- New `kts_beleg_payments` satellite, or
- Extend existing bank reconciliation matcher to lookup `trips.kts_belegnummer`

Trip-level columns alone are **insufficient for PR5** — payment is typically per Beleg/rechnung, not per trip leg. **Recommend:** index `trips.kts_belegnummer` now; add **`kts_beleg_summaries` view or PR5 table keyed by `(company_id, kts_belegnummer)`** when payment work starts.

### `kts_invoice_line_items` table?

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| **Stamp on trips only** (recommended PR4) | Simple; matches 1 CSV row → 1 trip commit; reuses trip as line item | Belegnummer duplicated on N trips; CSV row metadata not stored if row ≠ trip |
| **Line items table** (1 row per trip per import) | Normalized; stores CSV row snapshot | Redundant with trip columns for PR4; extra join everywhere |
| **Line items = CSV rows** (1 row per CSV line) + link table to trips | Preserves raw CSV; handles 1:N | Heavier schema; overkill if each CSV row maps to exactly one trip |

**Verdict:** **Trip columns + import batch header** sufficient for PR4 and PR6. **Do not** add `kts_invoice_line_items` in PR4 unless product requires retaining full CSV row payload (Arzt, Unternehmer, etc.) — if so, add `kts_external_invoice_lines` (CSV row archive) **without** duplicating trip stamp fields.

**Optional PR4 enhancement:** JSONB `source_rows` on `kts_external_invoices` for audit — defer unless compliance requires.

---

## 11. Senior recommendation — full PR4 schema

### Migration sequence

| Order | File | Contents |
| ----- | ---- | -------- |
| 1 | `20260610170000_kts_status_abgerechnet.sql` | `ALTER TYPE kts_status ADD VALUE 'abgerechnet' AFTER 'uebergeben';` + comment |
| 2 | `20260610171000_kts_external_invoices.sql` | Table + trip columns + indexes + RLS + grants |
| 3 | `20260610172000_apply_kts_invoice_import.sql` | RPC + optional `match_kts_invoice_import_candidates` |
| 4 | App | Regenerate `database.types.ts`; update `kts-status.ts`, actions cell, filters |

**Build gate:** `supabase db push` after each migration; `bun run build` after types + UI enum updates.

### Final `kts_status` enum order

```
ungeprueft → korrekt → fehlerhaft → in_korrektur → uebergeben → abgerechnet
```

(`NULL` when KTS off — unchanged.)

### `kts_external_invoices` DDL

See §4 above — append-only batch with optional `kts_handover_id`, filename, counts, audit timestamps.

### New `trips` columns

| Column | Type |
| ------ | ---- |
| `kts_belegnummer` | `text` |
| `kts_invoice_amount` | `numeric(12,2)` |
| `kts_eigenanteil` | `numeric(12,2)` |
| `kts_external_invoice_id` | `uuid` FK → `kts_external_invoices` ON DELETE SET NULL |

### RPC: `apply_kts_invoice_import`

```sql
apply_kts_invoice_import(
  p_company_id uuid,
  p_handover_id uuid,  -- nullable
  p_rows jsonb
) RETURNS TABLE (import_id uuid, updated_count int, skipped_count int)
```

- SECURITY DEFINER
- Guards: admin + company + handover company match (if provided)
- Per row: `kts_document_applies`, `kts_belegnummer IS NULL`, `kts_status = 'uebergeben'`
- Atomic: INSERT batch → UPDATE trips → status `abgerechnet`
- Row count verification after UPDATE

### Indexes

Listed in §4 — minimum: company on batch table, `(company_id, kts_belegnummer)` on trips, `kts_external_invoice_id`, `kts_patient_id` partial for matching.

### Justifications (deviations from simplest approach)

1. **Satellite `kts_external_invoices` vs trip columns only** — import batch audit (who/when/how many rows) and PR6 dashboard need a batch entity; trip columns alone lose import history.

2. **Optional `kts_handover_id` on import batch** — product allows CSV spanning multiple handovers; nullable FK records admin intent without enforcing 1:1.

3. **`abgerechnet` enum value vs boolean `kts_invoiced`** — consistent with existing workflow (`kts_status` drives queue UI, filters, KPIs); boolean would duplicate state.

4. **Trip-level Belegnummer duplicate across rows** — product expects same Belegnummer on outbound+return; UNIQUE constraint would break this.

5. **SECURITY DEFINER RPC vs client PATCH** — matches `create_kts_handover`; prevents partial imports and enforces re-import guard atomically.

6. **Hard commit guard `kts_status = 'uebergeben'`** — preview may show hints for other statuses, but commit should not silently invoice trips still in correction workflow; stricter than TS service layer, intentional.

7. **No `kts_invoice_line_items` in PR4** — trip stamp + batch header enough; defer line-item table unless raw CSV retention required.

### Risks & deferred items

| Risk | Mitigation |
| ---- | ---------- |
| Enum `ADD VALUE` not transactional in older Postgres | Run in dedicated migration; deploy app after DB |
| `Record<KtsStatus, …>` compile breaks | Update `kts-status.ts` in same PR |
| Name fallback false positives | Ambiguity bucket; server-side candidate RPC |
| Re-import force override | Deferred — RPC rejects; admin must clear fields manually if product allows later |
| PR5 payment state missing | Plan `kts_belegnummer` index; add payment satellite in PR5 |
| KPI cards don't show übergeben/abgerechnet | Accept for PR4; PR6 dashboard |
| Match preview in client vs server | Client Papa Parse OK; candidate match via API recommended |
| Amount parsing "36,00 €" | Client normalizes before JSON; RPC validates numeric |

---

## Cross-reference: prior audits

- [`docs/plans/pr4-csv-import-audit.md`](pr4-csv-import-audit.md) — UI, parsing, matching cascade, header slot
- [`docs/plans/kts-module-b-patient-id-audit.md`](kts-module-b-patient-id-audit.md) — snapshot semantics for `kts_patient_id`
- [`docs/kts-architecture.md`](../kts-architecture.md) §7.2 — PR4 roadmap row

*Audit only — no schema or code changes applied.*
