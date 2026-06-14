# KTS PR3.1 — Status enum audit (`kts_status`)

**Date:** 2026-06-10  
**Status:** **COMPLETE** — implemented per [`.cursor/plans/kts_pr3.1_status_b10cae3b.plan.md`](../../.cursor/plans/kts_pr3.1_status_b10cae3b.plan.md)  
**Scope:** Read-only audit for introducing an explicit `kts_status` enum on `trips` as the single source of truth for physical document location, replacing implicit state derived from `kts_fehler` + `kts_corrections`.  
**Constraint:** Audit was read-only; implementation shipped in PR3.1.

**Related:** [`docs/kts-architecture.md`](../kts-architecture.md), [`docs/plans/kts-pr3-5-page-shell-audit.md`](kts-pr3-5-page-shell-audit.md), PR3.3 handover (future), PR3.2 page shell (future).

---

## Business context (PR3.1)

TaxiGo admins compare physical KTS papers against trip records. **Flow 1** (this PR): document checking and correction rounds (`kts_corrections`). **Flow 2** (PR3.3): batch handover to accountant (`kts_handovers` — not in scope). **Flow 3** (PR4): CSV matching on `kts_patient_id`.

`kts_status` is additive; `kts_fehler` and `kts_fehler_beschreibung` remain for inline UI, pricing, and invoice logic (~40 read paths). The two must stay in sync:

| `kts_status` | `kts_fehler` |
| ------------ | ------------ |
| `fehlerhaft`, `in_korrektur` | `true` |
| `ungeprueft`, `korrekt` | `false` |
| `null` (KTS off) | `false` (cascade) |
| `uebergeben` | `false` |

---

## Sources read

- `supabase/migrations/` — full list; KTS chain read in full:
  - `20260403120000_kts_catalog_and_trips.sql`
  - `20260504130000_kts_fehler.sql`
  - `20260610120000_kts_corrections.sql`
  - `20260610125000_kts_rpc_tenant_guard.sql`
  - `20260610130000_kts_patient_id.sql`
- `src/types/database.types.ts` — `trips` Row/Insert/Update; `kts_corrections`
- `src/features/kts/kts.service.ts`, hooks
- `build-trip-details-patch.ts`, `kts-cells.tsx`, `duplicate-trips.ts`, `build-return-trip-insert.ts`, `recurring-trip-generator.ts`
- `create-trip-form.tsx` (KTS sections)
- `paired-trip-sync.ts`, `use-trip-field-update.ts`, `bulk-upload-dialog.tsx` (KTS insert paths)
- `docs/kts-architecture.md`

---

## 1. Migration timestamp

### KTS migration sequence (chronological)

| Timestamp | File |
| --------- | ---- |
| `20260403120000` | `kts_catalog_and_trips.sql` |
| `20260504130000` | `kts_fehler.sql` |
| `20260610120000` | `kts_corrections.sql` |
| `20260610125000` | `kts_rpc_tenant_guard.sql` |
| `20260610130000` | `kts_patient_id.sql` |

**Pattern:** `YYYYMMDDHHMMSS_description.sql`. Same-day KTS migrations increment the time suffix by **5000** (12:00 → 12:50 → 13:00).

### Last three migrations in repo (any domain)

```
20260610120000_kts_corrections.sql
20260610125000_kts_rpc_tenant_guard.sql
20260610130000_kts_patient_id.sql
```

### Recommended next timestamp

**`20260610140000_kts_status.sql`**

Rationale: continues the +5000 same-day sequence. If another non-KTS migration lands on 2026-06-10 first, use the next free slot after the latest file (still prefer grouping KTS schema changes in the `2026061014xxxx` block for readability).

---

## 2. Enum creation safety

### Proposed enum (PR3.1)

```sql
CREATE TYPE public.kts_status AS ENUM (
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben'
);
```

Column: `trips.kts_status public.kts_status NULL` — `NULL` when `kts_document_applies = false`.

### Coverage through PR3.3

| State | Purpose | PR |
| ----- | ------- | -- |
| `ungeprueft` | Paper not yet checked, or returned and awaiting re-check | 3.1 |
| `korrekt` | Checked clean, ready for handover | 3.1 |
| `fehlerhaft` | Error recorded, not yet sent to issuer | 3.1 |
| `in_korrektur` | Paper physically with issuer | 3.1 |
| `uebergeben` | Handed to accountant (terminal for clearing queue) | 3.3 |

**Verdict:** Five values are sufficient for PR3.1–PR3.3. Include `uebergeben` at creation time so no `ALTER TYPE ... ADD VALUE` is needed before handover PR.

### Edge cases — sixth state needed?

| Scenario | Recommendation |
| -------- | -------------- |
| **Cancelled trips** | No sixth state. Trip `status = cancelled` is operational; KTS document may still exist. Filter KTS page by `kts_document_applies` + `kts_status`; optionally exclude cancelled in UI. |
| **KTS toggled off then on** | `null` → `ungeprueft` (not `korrekt`). Handled by `normalizeKtsPatch`, not a new enum value. |
| **Duplicate / Rückfahrt / new recurring leg** | New trip row = new physical document workflow → **`ungeprueft`**, even if source was `korrekt` (see §6). Not a sixth state. |
| **Admin marks `korrekt`, later finds error** | **Gap in stated transitions.** Product needs either `korrekt → fehlerhaft` or `korrekt → ungeprueft`. Recommend allowing **`korrekt → fehlerhaft`** (explicit re-open) without new enum value. |
| **Admin flags `fehlerhaft`, then clears mistake before sending** | **Gap.** Recommend **`fehlerhaft → ungeprueft`** or **`fehlerhaft → korrekt`**. Again, no sixth state — add transitions in service layer. |
| **Multiple open correction rows** | Data integrity rule in service (close previous or reject insert), not enum. |
| **PR4 CSV matched / external invoice** | Out of scope for enum; future columns on trips or satellite tables. |

**PostgreSQL note:** `ALTER TYPE ... ADD VALUE` is safe in modern Postgres but awkward in transaction-heavy migration pipelines. Shipping all five values now is correct.

---

## 3. Column placement on `trips`

### Current `kts_*` column order

**Migration order (physical add sequence):**

1. `kts_document_applies` (NOT NULL, default `false`)
2. `kts_source` (nullable text)
3. `kts_fehler` (NOT NULL, default `false`)
4. `kts_fehler_beschreibung` (nullable text)
5. `kts_patient_id` (nullable text)

**`database.types.ts` Row order** (alphabetical within trips, not physical):

```
kts_document_applies
kts_fehler
kts_fehler_beschreibung
kts_patient_id
kts_source
```

(`reha_schein` follows immediately after the KTS block in types.)

### Recommended placement for `kts_status`

Add **after `kts_patient_id`** (or after `kts_source`) in the migration:

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_status public.kts_status DEFAULT NULL;
```

**Comment:** “Current physical/logical state of the KTS document; NULL when `kts_document_applies` is false.”

**CHECK constraint (recommended):**

```sql
CHECK (
  (kts_document_applies = false AND kts_status IS NULL)
  OR (kts_document_applies = true AND kts_status IS NOT NULL)
)
```

Enforces pairing at DB level; backfill must run before enabling NOT NULL on the pairing (status stays nullable, document_applies drives null).

**PR3.3 forward pointer:** Reserve `kts_handover_id uuid NULL REFERENCES kts_handovers(id)` adjacent to `kts_status` in a later migration — do not add in PR3.1.

---

## 4. `normalizeKtsPatch` — sync requirement

Current rules ([`kts.service.ts`](../../src/features/kts/kts.service.ts)):

1. `kts_document_applies: false` → `kts_fehler: false`, `kts_fehler_beschreibung: null` (not `kts_patient_id`)
2. `kts_fehler: false` → `kts_fehler_beschreibung: null`
3. `kts_document_applies: true` without `kts_source` → `kts_source: 'manual'`
4. Trim `kts_fehler_beschreibung`, `kts_patient_id`

### Required changes for PR3.1

| Rule | Behavior |
| ---- | -------- |
| **(a) KTS ON** | When `'kts_document_applies' in patch && patch.kts_document_applies === true`: if `'kts_status' not in patch`, set `kts_status: 'ungeprueft'`. **Exception:** transition functions and backfill may pass explicit status; do not overwrite if key present. |
| **(b) KTS OFF** | When `kts_document_applies === false`: set `kts_status: null` (in addition to existing fehler/beschreibung clear). |
| **(c) Raw `kts_fehler` toggle** | **Do not** auto-update `kts_status` when only `kts_fehler` is in patch. **However:** new code should prefer status transition functions; legacy inline switch is a drift risk (see §7). |
| **(d) Status in patch** | When `'kts_status' in patch`: sync `kts_fehler` — `true` if status ∈ `{fehlerhaft, in_korrektur}`, else `false`. Do **not** clear `kts_fehler_beschreibung` on status alone unless moving to non-error states (optional: clear beschreibung when → `korrekt` or `ungeprueft` — product decision). |
| **(e) Transition functions** | Implement as **separate exports** that build a full patch and call `normalizeKtsPatch` once — not as ad-hoc UI patches. Keeps testability and matches existing `updateTripKts` pattern. |

### Interaction with `buildKtsPatchFromDrafts`

Today diffs `kts_document_applies`, `kts_fehler`, beschreibung, patient ID. For PR3.1:

- Detail sheet should stop driving workflow via raw `ktsFehlerDraft` for new flows (or map draft changes to transition calls).
- `buildKtsPatchFromDrafts` should **not** set `kts_status` from fehler draft alone (violates rule c).

### `insertKtsCorrection` / `closeKtsCorrection`

Today **only** touch `kts_corrections` — no trip row update. PR3.1 **`sendKtsCorrection`** / **`receiveKtsCorrection`** must update **both** tables in one logical operation (service-level transaction or sequential calls with shared patch).

---

## 5. New service functions

All should accept `SupabaseClient` or use existing `updateTripKts` + correction helpers; return updated `Trip` and/or `KtsCorrection`.

### Signatures and behavior

```typescript
/** Admin verified document — ready for handover batch (PR3.3). */
export async function markKtsChecked(
  tripId: string
): Promise<Trip>;
// Patch: { kts_status: 'korrekt', kts_fehler: false }
// Optional: clear kts_fehler_beschreibung? (product: probably keep history text)

/** Record error before sending to issuer. */
export async function markKtsFehlerhaft(
  tripId: string,
  beschreibung: string
): Promise<Trip>;
// Patch: { kts_status: 'fehlerhaft', kts_fehler: true, kts_fehler_beschreibung: trimmed }

/** Physical send to issuer — opens correction round. */
export async function sendKtsCorrection(
  supabase: SupabaseClient,
  payload: {
    tripId: string;
    companyId: string;
    sentTo: string;
    sentAt?: Date;
    notes?: string;
  }
): Promise<{ trip: Trip; correction: KtsCorrection }>;
// 1. insertKtsCorrection(...)
// 2. updateTripKts(tripId, { kts_status: 'in_korrektur', kts_fehler: true })

/** Corrected document returned — re-check required. */
export async function receiveKtsCorrection(
  supabase: SupabaseClient,
  payload: {
    tripId: string;
    correctionId: string;
    receivedAt?: Date;
  }
): Promise<{ trip: Trip; correction: KtsCorrection }>;
// 1. closeKtsCorrection(...)
// 2. updateTripKts(tripId, { kts_status: 'ungeprueft', kts_fehler: false })
```

**PR3.3 (stub only):**

```typescript
export async function markKtsUebergeben(tripId: string, handoverId: string): Promise<Trip>;
// { kts_status: 'uebergeben', kts_handover_id, kts_fehler: false }
```

### Replaces / composes with existing API

| New function | Existing | Relationship |
| ------------ | -------- | ------------ |
| `markKtsChecked` | Manual `kts_fehler: false` toggle; future “clean” button | **Replaces** implicit “no fehler = clean” |
| `markKtsFehlerhaft` | `KtsFehlerSwitchCell` + beschreibung; detail sheet fehler draft | **Replaces** raw fehler toggle for workflow |
| `sendKtsCorrection` | `useInsertKtsCorrectionMutation` alone | **Composes** insert + status; UI must not insert without status |
| `receiveKtsCorrection` | `useCloseKtsCorrectionMutation` alone | **Composes** close + status |
| `updateTripKts` / `normalizeKtsPatch` | Unchanged entry for KTS ON/OFF and catalog fields | Extended with status sync rules |
| `useUpdateKtsMutation` | Inline KTS / fehler switches | Keep for KTS ON/OFF; **deprecate fehler switch** on list once page shell ships |

### React Query invalidation (minimum)

| Mutation | Invalidate |
| -------- | ---------- |
| All trip status writes | `tripKeys.detail(tripId)`, `tripKeys.all` |
| Correction round changes | `tripKeys.ktsCorrections(tripId)` |
| PR3.2 page (future) | `ktsKeys.dashboardStats()` (or equivalent), `tripKeys.ktsCorrectionSummaries(sortedIds)` |

**Gap today:** `useInsertKtsCorrectionMutation` / `useCloseKtsCorrectionMutation` only invalidate `ktsCorrections` — PR3.1 hooks must also invalidate `tripKeys.all` when trip status changes.

---

## 6. Write paths that must stay in sync

Any path that sets **`kts_document_applies = true`** on insert or update must also set **`kts_status = 'ungeprueft'`** (unless explicitly copying/handover — see notes).

| Path | File | Function / location | Sets KTS ON? | PR3.1 action |
| ---- | ---- | ------------------- | ------------ | ------------ |
| **Neue Fahrt submit** | `create-trip-form.tsx` | Submit handler ~L1319 | When `values.kts_document_applies` | Add `kts_status: 'ungeprueft'` to insert payload (or helper wrapping insert) |
| **Inline KTS switch ON** | `kts-cells.tsx` | `KtsSwitchCell.handleChange` | `patch: { kts_document_applies: true }` | **`normalizeKtsPatch`** adds `ungeprueft` — no cell change if rule (a) in service |
| **Detail sheet save** | `build-trip-details-patch.ts` → `buildKtsPatchFromDrafts` | KTS toggle ON diff | When draft ON vs was OFF | Same — service cascade |
| **Paired trip sync** | `paired-trip-sync.ts` | `buildPartnerSyncPatchFromDrafts` | When partner gets KTS ON | `normalizeKtsPatch` on partner patch |
| **Bulk CSV import** | `bulk-upload-dialog.tsx` | Row insert ~L1020 | When `ktsDocumentApplies` | Add `kts_status: 'ungeprueft'` on insert |
| **Recurring cron** | `recurring-trip-generator.ts` | `buildTripPayload` ~L289 | When `rule.kts_document_applies` | Add `kts_status: 'ungeprueft'` when true, else omit/null |
| **Duplicate trip** | `duplicate-trips.ts` | `copyRouteAndPassengerFields` | Copies source flag | **Do not copy status/fehler from source** — if `kts_document_applies: true`, force `kts_status: 'ungeprueft'`, `kts_fehler: false`, beschreibung null |
| **Rückfahrt insert** | `build-return-trip-insert.ts` | `buildReturnTripInsert` | Copies outbound flag | Same as duplicate — **new leg = ungeprueft**, not inherited error state |
| **Bulk import return leg** | `bulk-upload-dialog.tsx` | `buildReturnTrip` | Via return builder | Same rule via shared helper |
| **Regelfahrt rule save** | `build-recurring-rule-payload.ts` | Rule row only | Rule flag, not trip | No trip status; cron path above handles generated trips |

**Important:** Duplicate/Rückfahrt today **copy** `kts_fehler` + beschreibung from source via `normalizeKtsPatch(rawKts)`. PR3.1 should introduce a **`normalizeKtsInsertFromSource()`** (or extend `normalizeKtsPatch` with `{ mode: 'new_trip' }`) that resets workflow fields while preserving `kts_document_applies`, `kts_source`, `kts_patient_id` policy.

---

## 7. Existing `kts_fehler` usage risk

### Read usage

~40 files: list filters (`trips-listing.tsx`, `trips-filters-bar.tsx`), columns, print/PDF, invoice builder, price engine, controlling RPC, etc. **No change required for reads** if sync is maintained.

### Write paths for `kts_fehler` boolean

| Path | Through `normalizeKtsPatch`? | Notes |
| ---- | --------------------------- | ----- |
| `useUpdateKtsMutation` ← `KtsFehlerSwitchCell` | **Yes** | Will drift from `kts_status` unless toggle removed or mapped |
| `buildKtsPatchFromDrafts` ← detail sheet | **Yes** | Sets fehler from draft without status — drift risk |
| `paired-trip-sync.ts` | **Yes** | Same |
| `duplicate-trips.ts` / `build-return-trip-insert.ts` | **Yes** (copy path) | Copies fehler from source |
| **`create-trip-form.tsx`** ~L1305–1321 | **No** — inline insert | `ktsFehlerForDb = kts_document_applies && kts_fehler`; defaults `false` |
| **`useTripFieldUpdate`** ← `KtsFehlerTextCell` | **No** — beschreibung only | Updates `kts_fehler_beschreibung`, not boolean |
| **`bulk-upload-dialog.tsx`** | **No** | Does not set `kts_fehler` (DB default `false`) |
| **`recurring-trip-generator.ts`** | **No** | Does not set `kts_fehler` (DB default `false`) |

### Answer

**Yes — paths exist that set `kts_fehler` without going through `normalizeKtsPatch`:**

1. **`create-trip-form.tsx`** lines ~1305–1321 — direct insert with inline normalization (boolean only; always safe default `false` today).
2. **`KtsFehlerSwitchCell`** goes through `normalizeKtsPatch` but **will desync `kts_status`** once status exists, because rule (c) forbids auto-status from fehler toggle.

**No raw SQL / RPC** sets `kts_fehler` outside the app layer found in migrations.

### Mitigation plan

1. All **status** changes only via §5 transition functions.
2. Extend `normalizeKtsPatch` to sync `kts_fehler` **from** `kts_status` when status is in patch (one direction for workflow).
3. Deprecate list **KTS-Fehler switch** after KTS page ships; keep field for reads/filters until migrated to status filters.
4. Route `create-trip` inserts through a shared **`normalizeKtsInsert()`** helper.

---

## 8. Index recommendation

### Query pattern (PR3.2)

```sql
SELECT ... FROM trips
WHERE company_id = $1
  AND kts_document_applies = true
  AND kts_status = $2
ORDER BY scheduled_at DESC NULLS LAST;
```

Plus KPI counts: `COUNT(*) ... GROUP BY kts_status` with same tenant + `kts_document_applies = true`.

### Existing patterns in repo

| Migration | Pattern |
| --------- | ------- |
| `20260514130000_trips_performance_indexes.sql` | Composite `(company_id, <filter_column>)` — no partial |
| `20260404103000_no_invoice_fremdfirma_recurring.sql` | **Partial:** `idx_trips_fremdfirma_id ON trips (fremdfirma_id) WHERE fremdfirma_id IS NOT NULL` |

### Recommendation

**Primary (PR3.1 migration):**

```sql
CREATE INDEX IF NOT EXISTS idx_trips_company_kts_status
  ON public.trips (company_id, kts_status)
  WHERE kts_document_applies = true;
```

**Optional second index** if list sorts by date within status (planner may combine filters):

```sql
CREATE INDEX IF NOT EXISTS idx_trips_company_kts_status_scheduled
  ON public.trips (company_id, kts_status, scheduled_at DESC NULLS LAST)
  WHERE kts_document_applies = true;
```

Start with the **two-column partial** index; add the three-column variant only if `EXPLAIN ANALYZE` on the KTS page shows sort-heavy plans.

**Open corrections KPI** (not trip status): existing `kts_corrections (company_id)` + `(trip_id, created_at DESC)` suffice; optional partial `WHERE received_at IS NULL` on `kts_corrections` if “open rounds” counts are hot.

---

## 9. `kts_corrections` interaction

### Full constraint set (`20260610120000_kts_corrections.sql`)

| Kind | Definition |
| ---- | ---------- |
| **PK** | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| **FK** | `company_id → companies(id) ON DELETE CASCADE` |
| **FK** | `trip_id → trips(id) ON DELETE CASCADE` |
| **FK** | `created_by → auth.users(id) ON DELETE SET NULL` |
| **NOT NULL** | `company_id`, `trip_id`, `sent_to`, `sent_at`, `created_at` |
| **Nullable** | `received_at`, `notes`, `created_by` |
| **Indexes** | `(trip_id)`, `(company_id)`, `(trip_id, created_at DESC)` |
| **RLS** | SELECT / INSERT / UPDATE scoped to `accounts.company_id`; **no DELETE** |
| **Grants** | `SELECT, INSERT, UPDATE` to `authenticated`, `service_role` |

**No triggers.** No CHECK on “only one open round per trip.” No FK from `trips` to `kts_corrections`.

### Conflict check for PR3.1 operations

| Operation | Conflict? |
| --------- | --------- |
| `sendKtsCorrection`: insert row + `kts_status = in_korrektur` | **None** — insert always allowed; app should avoid duplicate open rounds by convention |
| `receiveKtsCorrection`: `received_at = now()` + `kts_status = ungeprueft` | **None** — `closeKtsCorrection` already uses `.is('received_at', null)` guard |
| `kts_fehler = true` on send | Already true in `fehlerhaft`; idempotent |
| `kts_fehler = false` on receive | Aligns with `ungeprueft` sync rule |

**Optional hardening (not required for PR3.1):** partial unique index `UNIQUE (trip_id) WHERE received_at IS NULL` — would enforce one open round at DB level; discuss before adding (blocks concurrent draft rows).

---

## 10. Docs gap (`docs/kts-architecture.md`)

### Add new section: **§3.4 `kts_status` state machine (PR3.1)**

Content to include:

1. **Enum values** (German labels for UI: Ungeprüft, Korrekt, Fehlerhaft, In Korrektur, Übergeben).
2. **State diagram** (transitions from PR3.1 spec + recommended reverse transitions from §2).
3. **Sync rule** with `kts_fehler` / `kts_fehler_beschreibung` (table from business context).
4. **Relationship to `kts_corrections`:** status = where paper is **now**; corrections = **history**.
5. **Backfill rules** (never auto-`korrekt` / `uebergeben`).
6. **KTS OFF** → `kts_status NULL`; **KTS ON** → `ungeprueft`.
7. **Write authority:** transition functions in `kts.service.ts`; `normalizeKtsPatch` cascade updates.

### Update existing sections

| Section | Change |
| ------- | ------ |
| **§3 Trip persistence** | Add `kts_status` row to table |
| **§3.2 Duplicate and Rückfahrt** | New trips → `ungeprueft`, do not copy fehler/status |
| **§7.1 KTS write service** | Document new exports + extended cascade rules |
| **§7.2 Roadmap** | Add **PR3.1** (status enum), renumber: PR3.2 page shell, PR3.3 handover; align PR6 dashboard |
| **§8 V2 `kts_reviews`** | Clarify: PR3.1 **`kts_status` on trips** is current-state; `kts_reviews` remains optional append-only audit V2 — avoid duplicate concepts |
| **§10 Code map** | Transition hooks, query keys, migration filename |
| **§9 Implementation status** | PR3.1 pending entry |

### Forward pointers

- **PR3.2:** `/dashboard/kts`, filter tabs by `kts_status`, stat `COUNT` per status.
- **PR3.3:** `kts_handovers`, `trips.kts_handover_id`, `markKtsUebergeben`, terminal `uebergeben`.

---

## Backfill SQL (reference for migration)

Run in same migration after ADD COLUMN:

```sql
UPDATE public.trips t
SET kts_status = CASE
  WHEN NOT t.kts_document_applies THEN NULL
  WHEN t.kts_fehler AND EXISTS (
    SELECT 1 FROM public.kts_corrections kc
    WHERE kc.trip_id = t.id AND kc.received_at IS NULL
  ) THEN 'in_korrektur'::public.kts_status
  WHEN t.kts_fehler THEN 'fehlerhaft'::public.kts_status
  ELSE 'ungeprueft'::public.kts_status
END;
```

Never set `korrekt` or `uebergeben` in backfill.

Post-backfill: optional sync verify:

```sql
-- fehlerhaft/in_korrektur ⇒ kts_fehler true; others ⇒ false
UPDATE public.trips SET kts_fehler = (kts_status IN ('fehlerhaft', 'in_korrektur'))
WHERE kts_document_applies = true;
```

---

## Senior recommendation: generated column vs application sync

### Question

Should `kts_fehler` be `GENERATED ALWAYS AS (kts_status IN ('fehlerhaft','in_korrektur')) STORED`?

### Recommendation: **Keep `kts_fehler` as an independent column synced in `kts.service.ts` (application layer). Do not use a generated column.**

| Factor | Generated column | Application sync (`kts.service.ts`) |
| ------ | ---------------- | ----------------------------------- |
| **Existing writes** | **Breaks** ~15+ write paths that SET `kts_fehler` directly (`KtsFehlerSwitchCell`, detail draft, create-trip insert, duplicate copy) — Postgres rejects writes to generated columns | Incremental migration: extend `normalizeKtsPatch` + transition functions; legacy paths keep working during rollout |
| **Read paths** | ~40 files unchanged | ~40 files unchanged |
| **Pricing / invoice** | Engine reads `kts_fehler` boolean today | Same; sync guarantees consistency when status changes |
| **Rule (c)** | Forces all fehler changes through status only — good long-term but **big-bang** | Allows phased deprecation of fehler toggle |
| **Backfill** | Must drop/recreate column or migrate type | One UPDATE to align both fields |
| **Debugging** | Single source in DB | Must trust service — mitigate with tests + optional **DB trigger** later (`BEFORE INSERT OR UPDATE ON trips` sync fehler from status if status changed) |
| **Insert paths** | Must set `kts_status` on every KTS insert; cannot omit fehler | `normalizeKtsInsert()` sets both |

### Optional belt-and-suspenders (PR3.1 or follow-up)

A **`BEFORE INSERT OR UPDATE` trigger** on `trips` that sets:

```sql
kts_fehler := (NEW.kts_status IN ('fehlerhaft', 'in_korrektur'));
```

when `NEW.kts_status IS NOT NULL`, without making the column GENERATED. This catches any stray `updateTrip` bypassing the service while still allowing explicit fehler writes during migration (trigger runs after row values assigned — order matters; prefer trigger only when `kts_status` is in the mutation).

**Do not** adopt generated column — cost of rewriting all write paths exceeds benefit; application authority matches existing PR1 “single write service” architecture.

---

## Summary checklist for PR3.1 implementation

- [ ] Migration `20260610140000_kts_status.sql`: enum, column, CHECK, backfill, partial index
- [ ] Regenerate `database.types.ts`
- [ ] Extend `normalizeKtsPatch` (rules a, b, d)
- [ ] Add transition functions + hooks
- [ ] Update insert paths (create, cron, bulk, duplicate, return)
- [ ] Invalidate `tripKeys.all` on correction compose mutations
- [ ] Update `docs/kts-architecture.md` §3.4 + roadmap
- [ ] Tests: cascade, backfill mapping, transition guards, sync invariant

---

## Related documents

- [`docs/kts-architecture.md`](../kts-architecture.md)
- [`docs/plans/kts-pr3-5-page-shell-audit.md`](kts-pr3-5-page-shell-audit.md)
- [`docs/plans/kts-pr1-deferred-paths-audit.md`](kts-pr1-deferred-paths-audit.md)
