# v4 Pre-Implementation Audit — Cron Dedup + Link Graph Integrity

Read-only audit. **No code or data changes.**

Date: **2026-06-23**  
Project: TaxiGo Admin Dashboard (`etwluibddvljuhkxjkxs`)  
Related: [`widget-persistence-audit.md`](widget-persistence-audit.md), [`invalidation-contract.md`](../trips/invalidation-contract.md)

---

## Executive summary

| Bug | Root cause (code + data) | Scope |
| --- | --- | --- |
| **A — Duplicate rule rows** | Dedup exists but is **fragile**: `maybeSingle()` fails when >1 row matches; **`requested_date` NULL vs set** splits the same calendar leg into different dedup keys; no DB unique constraint | **Kira Herbers** is a live example (two active outbounds for 2026-06-23). Per-leg duplicate groups with `requested_date IS NOT NULL`: **0**. Legacy `requested_date IS NULL` bucket: **Ingrid Schultz** (4 outbound + 3 return in one group). |
| **B — Broken bidirectional links** | Materialiser only **updates outbound → return** after pairing; **never repoints an existing return** to a new outbound. `create-linked-return.ts` is bidirectional for **new** manual pairs only. | **416** active trips with one-way links (not Kira-only). |

---

## Database queries

### Q1 — Duplicate `rule_id + requested_date + client_id` combinations

**Query (as specified):** groups with `COUNT(*) > 1`, active trips only, `LIMIT 50`.

**Aggregate (full table, not limited):**

| Metric | Count |
| --- | --- |
| Groups with exactly **2** rows | **163** |
| Groups with **>2** rows | **1** |
| Total duplicate groups | **164** |

**Interpretation:** Almost all “duplicates” in the naive query are **expected outbound + return pairs** (2 rows, `link_types`: `outbound`, `return`). They are not Bug A.

**True duplicate legs** — same `(rule_id, requested_date, client_id, link_type)` among active trips:

| rule_id | requested_date | client | link_type | count |
| --- | --- | --- | --- | --- |
| `0e23c4eb-…` | **NULL** | Ingrid Schultz | outbound | **4** |
| `0e23c4eb-…` | **NULL** | Ingrid Schultz | return | **3** |

**Per-leg duplicates where `requested_date IS NOT NULL`:** **0 groups** (query returned empty).

**Kira Herbers 2026-06-23 (Bug A pattern without same dedup key):**

| id | link_type | requested_date | scheduled_at (Berlin) | linked_trip_id | created_at |
| --- | --- | --- | --- | --- | --- |
| `54d92673-…` | outbound | **NULL** | 11:00 | **NULL** | 2026-06-09 |
| `5185b63f-…` | outbound | **2026-06-23** | 13:30 | **NULL** | 2026-06-23 |

Two **outbound** rows for the same rule/client/day — dedup treats them as different keys because `requested_date` differs (NULL vs `2026-06-23`). Return leg `21a65157-…` from the persistence audit **no longer exists** in the database (deleted or cleaned up).

**Return duplicates?** Among active per-leg duplicate groups, only Ingrid’s `requested_date IS NULL` bucket shows extra returns (3 vs 1 expected). No other active return-leg duplicate groups.

---

### Q2 — Kira Herbers link graph (2026-06-23)

**Query IDs:** `5185b63f`, `21a65157`, `54d92673`.

**Current DB state (2026-06-23 audit run):**

Only **two** rows returned; `21a65157` **not found**.

```
54d92673 (outbound, legacy)     linked_trip_id: NULL
5185b63f (outbound, cron-new)   linked_trip_id: NULL
```

**Link graph (current):** two orphan outbounds — no edges.

**Persistence audit graph (historical, 2026-06-23):**

```
5185b63f (new outbound) → 21a65157 (return, unscheduled)
21a65157 (return)         → 54d92673 (old outbound)
54d92673 (old outbound)   → 21a65157
```

Return pointed to **old** outbound (`54d92673`), not new (`5185b63f`) — classic Bug B.

---

### Q3 — Broken bidirectional links

**Query:** `t1.linked_trip_id IS NOT NULL`, active trips, partner does not point back to `t1.id`.

| Metric | Value |
| --- | --- |
| **Total broken links** | **416** |
| Sample size | 50 (most recent) |

**Pattern in sample:** overwhelmingly **`link_type = 'return'`** with `partner_points_to = NULL` — return points to an outbound that does **not** link back (or outbound’s `linked_trip_id` is NULL).

**Examples in sample:** Helga Holz, Anne Hajen, Ibrahim Ahmad, Ulrike Klöver-Stallmann, **Kira Herbers**, many others.

**Conclusion:** **Systemic**, not Kira-only.

---

### Q4 — Ingrid Schultz rule `0e23c4eb-…`

**Latest 10 rows by `created_at`:** shows normal **outbound+return pairs** for future dates with **consistent bidirectional** links.

**2026-06-23 specifically:**

| id | leg | scheduled_at | linked_trip_id | status |
| --- | --- | --- | --- | --- |
| `b7fba5af-…` | return | **2026-06-23 13:30 UTC** (15:30 Berlin) | **NULL** | assigned |

**Row `9ae9b84c-…` (duplicate unscheduled outbound from persistence audit):** **not found** — removed from DB since prior audit.

**Widget visibility today:**

- **Offene Touren:** `b7fba5af` has `scheduled_at` set → **not** in unplanned widget.
- **Regelfahrten ohne Zeit:** requires `scheduled_at IS NULL` → **not** in timeless widget.

**Has `9ae9b84c` been scheduled manually?** N/A — row no longer exists.

---

### C3 — Unique constraints on `trips`

**Result:** only `idx_trips_company_requested_date` on `(company_id, requested_date)`.

**No unique index** on `(rule_id, requested_date, client_id)` or including `link_type`.

**Conclusion:** Application-level dedup in `generateRecurringTrips` is the **only** enforcement.

---

## Code analysis

### C1 — Materialisation

`recurring-rules.actions.ts` does **not** insert trips. Inserts live in [`src/lib/recurring-trip-generator.ts`](../../src/lib/recurring-trip-generator.ts).

**a. Insert:** plain `supabase.from('trips').insert(row)` — no upsert, no `ON CONFLICT`.

**b. Pre-insert check — verbatim:**

```typescript
async function findExistingRecurringLegId(q: {
  client_id: string;
  rule_id: string;
  requested_date: string;
  leg: 'outbound' | 'return';
}): Promise<string | null> {
  let query = supabase
    .from('trips')
    .select('id')
    .eq('client_id', q.client_id)
    .eq('rule_id', q.rule_id)
    .eq('requested_date', q.requested_date);

  if (q.leg === 'outbound') {
    query = query.or('link_type.is.null,link_type.eq.outbound');
  } else {
    query = query.eq('link_type', 'return');
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data.id;
}
```

**Failure modes:**

1. **`maybeSingle()` when ≥2 rows match** → error → returns `null` → **insert proceeds**.
2. **`requested_date` NULL vs YMD** — legacy rows never match new materialisation (Kira).
3. **`insertIfAbsent` never updates** existing rows — skipped id still used for linking.

**c. Triggers:**

| Trigger | Generates trips? |
| --- | --- |
| Rule **create** | Yes — `runCreateWithGeneration` → `triggerGenerationForRule` |
| Rule **update** | No — resync/delete only |
| **Cron** (daily) | Yes — all active rules, 14-day horizon |
| On-demand | `triggerGenerationForRule(ruleId)` |

Same date can be processed on **every cron run**; second run should skip unless dedup fails.

---

### C2 — `create-linked-return.ts`

**a.** Updates outbound: `linked_trip_id: created.id`, `link_type: 'outbound'`.  
**b.** Return insert sets `linked_trip_id: outbound.id`, `link_type: 'return'`.  
**c.** Second outbound → existing return: **not handled** in this module.

**Materialiser (Bug B):** after `insertIfAbsent`, only updates outbound:

```typescript
await supabase
  .from('trips')
  .update({ linked_trip_id: returnId, link_type: 'outbound' })
  .eq('id', outboundId);
```

When return already existed, it still points to the **previous** outbound. No return-side update.

---

### C4 — Widget partner awareness

**Offene Touren:** loads `trip.linked_trip { scheduled_at, status, link_type }`. Shows Rückfahrt badge, cancelled-partner badge, “Hinfahrt: {time}” on return rows. **No** “partner leg still unscheduled” indicator on outbound rows.

**Regelfahrten ohne Zeit:** pairs outbound+return in one row — partner context is built-in.

**Data available without extra query:**

```typescript
trip.linked_trip_id &&
  trip.linked_trip &&
  trip.linked_trip.scheduled_at == null &&
  trip.linked_trip.status !== 'cancelled';
```

---

## Senior diagnosis

### 1. Dedup — application only, DB only, or both?

**Both.** Application guard exists but fails open; DB has no unique constraint.

### 2. Broken links — one-off or systemic?

**Systemic** — 416 active broken links.

### 3. Minimal safe dedup fix

**Recommended: (c) Both**

- **Application:** replace fail-open `maybeSingle`; canonical row when multiples exist; match legacy NULL `requested_date` to Berlin YMD for same rule/client/day; include **leg** (`link_type`) in key.
- **Database:** partial unique index on `(rule_id, requested_date, client_id, link_type)` after backfill/cleanup.

Note: count = 2 in naive Q1 is **valid** (outbound + return).

### 4. Link repair

- **One-time SQL:** yes — 416 rows + Kira/Ingrid cleanup.
- **Materialiser fix:** yes — bidirectional link updates when reusing existing legs; otherwise cron regresses.

### 5. Widget UX

Use existing `linked_trip` embed in Offene Touren for partner-unscheduled badge. Timeless widget already pairs legs.

---

## v4 implementation checklist (not executed here)

1. Backfill `requested_date` on legacy rule trips.
2. Harden `findExistingRecurringLegId` / `insertIfAbsent`.
3. Bidirectional link repair in materialiser.
4. Partial unique index after cleanup.
5. One-time repair script for broken links and duplicate legs.
6. Optional widget badge for partner-unscheduled.
7. Regression tests: second cron run; existing return + new outbound; NULL `requested_date` legacy rows.

---

## Files read

- [`src/features/trips/api/recurring-rules.actions.ts`](../../src/features/trips/api/recurring-rules.actions.ts)
- [`src/lib/recurring-trip-generator.ts`](../../src/lib/recurring-trip-generator.ts)
- [`src/features/trips/lib/create-linked-return.ts`](../../src/features/trips/lib/create-linked-return.ts)
- [`src/features/trips/api/trips.service.ts`](../../src/features/trips/api/trips.service.ts)
- [`src/features/clients/components/recurring-rule-panel.tsx`](../../src/features/clients/components/recurring-rule-panel.tsx)
- [`src/features/clients/components/recurring-rule-sheet.tsx`](../../src/features/clients/components/recurring-rule-sheet.tsx)
- [`src/features/clients/lib/recurring-rule-submit-flow.ts`](../../src/features/clients/lib/recurring-rule-submit-flow.ts)
- [`src/query/keys/trips.ts`](../../src/query/keys/trips.ts)
- [`docs/trips/invalidation-contract.md`](../trips/invalidation-contract.md)
- [`docs/plans/widget-cache-staleness-audit.md`](widget-cache-staleness-audit.md)
- [`src/app/api/cron/generate-recurring-trips/route.ts`](../../src/app/api/cron/generate-recurring-trips/route.ts)
- [`src/features/dashboard/hooks/use-unplanned-trips.ts`](../../src/features/dashboard/hooks/use-unplanned-trips.ts)
- [`src/features/dashboard/hooks/use-timeless-rule-trips.ts`](../../src/features/dashboard/hooks/use-timeless-rule-trips.ts)
- [`src/features/dashboard/components/pending-tours-widget.tsx`](../../src/features/dashboard/components/pending-tours-widget.tsx)
- [`src/features/dashboard/components/timeless-rule-trips-widget.tsx`](../../src/features/dashboard/components/timeless-rule-trips-widget.tsx)
