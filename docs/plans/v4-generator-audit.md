# v4 Pre-Implementation Audit — `recurring-trip-generator.ts` Deep Read + Link Graph Root Cause

**Date:** 2026-06-23  
**Scope:** Read-only — no code or data changes  
**DB project:** `etwluibddvljuhkxjkxs` (Supabase)  
**Prerequisite audits:** [`v4-cron-dedup-audit.md`](v4-cron-dedup-audit.md), [`v4-timezone-audit.md`](v4-timezone-audit.md)

---

## Executive summary

| Bug | Root cause in generator | Production impact |
|-----|-------------------------|-------------------|
| **A — Dedup fails open** | `findExistingRecurringLegId` uses `.maybeSingle()`; on ≥2 rows or on `requested_date IS NULL` mismatch, returns `null` → `insertIfAbsent` inserts again | Duplicate legs per rule/date; cron re-runs amplify NULL-key rows |
| **B — Bidirectional link gap** | Only **one** UPDATE after pairing (outbound ← return). Return gets `linked_trip_id` on **INSERT** only; when outbound is reused/repointed, return is never updated. Historical runs left **415** returns pointing at outbounds that do not point back | `getTripDirection`, widgets, paired cancel/reschedule break |

**416 broken active links** (query below): **415** on `link_type = 'return'`, **1** on `link_type = 'outbound'` (partner points to wrong outbound).

---

## 1. Generator structure

### G1 — Every function in `recurring-trip-generator.ts`

| Name | Exported | Parameters | Return type | Description |
|------|----------|------------|-------------|-------------|
| `deriveStationsForTrip` | **yes** | `rule: { pickup_station, dropoff_station }`, `isReturnTrip: boolean` | `{ pickup_station, dropoff_station }` | Swaps route station codes for return legs |
| `generateRecurringTrips` | **yes** | `options?: { ruleId?: string; supabase?: SupabaseClient<Database> }` | `Promise<GenerateRecurringTripsResult>` | Top-level materialiser: loads rules, expands RRule, inserts/skips trips |
| `resolveGeoLine` | no (nested) | `line: string` | `Promise<GeocodedAddressLineResult \| null>` | Geocode with in-memory cache |
| `mergeLegCoords` | no (nested) | `live`, `lat`, `lng` | `GeocodedAddressLineResult` | Merge rule coords into geocode result |
| `buildTripPayload` | no (nested) | `{ rule, client, clientName, dateStr, isReturnTrip, returnMode, exceptionTimeKey, scheduledAtIso, linkedTripId, outboundLinkType, billing_type_id }` | `Promise<TripInsert \| null>` | Builds full insert row; returns `null` if cancelled/invalid |
| `findExistingRecurringLegId` | no (nested) | `{ client_id, rule_id, requested_date, leg: 'outbound' \| 'return' }` | `Promise<string \| null>` | Pre-insert dedup lookup |
| `insertIfAbsent` | no (nested) | `row: TripInsert`, `dedupKey: { client_id, rule_id, requested_date, leg }` | `Promise<string \| null>` | Dedup then insert; returns trip id |

**Exported constants/types:** `RECURRING_TRIP_GENERATION_HORIZON_DAYS`, `GenerateRecurringTripsResult`, `deriveStationsForTrip`.

---

### G2 — Cron entry point

**Cron route** (`src/app/api/cron/generate-recurring-trips/route.ts`) — full file:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { generateRecurringTrips } from '@/lib/recurring-trip-generator';

export const dynamic = 'force-dynamic';

/** SECURITY: CRON_SECRET via Authorization: Bearer (Vercel Cron) or x-cron-secret — see docs/access-control.md */

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const authorization = request.headers.get('authorization');
    const bearerMatches = authorization === `Bearer ${cronSecret}`;
    const headerSecret = request.headers.get('x-cron-secret');
    const xCronMatches = headerSecret === cronSecret;
    if (!bearerMatches && !xCronMatches) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        {
          error:
            'Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for cron.'
        },
        { status: 500 }
      );
    }

    const result = await generateRecurringTrips();

    return NextResponse.json({
      generated: result.generated,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('Cron Error generating recurring trips:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**No timezone parameter.** Cron calls `generateRecurringTrips()` with no arguments.

**Top-level generator signature + first 20 lines of body:**

```typescript
export async function generateRecurringTrips(options?: {
  ruleId?: string;
  supabase?: SupabaseClient<Database>;
}): Promise<GenerateRecurringTripsResult> {
  const supabase = options?.supabase ?? createAdminClient();

  const inTz = tz(getTripsBusinessTimeZone());
  const todayLocal = startOfDay(inTz(Date.now()), { in: inTz });
  const windowEndLocal = endOfDay(
    addDays(todayLocal, RECURRING_TRIP_GENERATION_HORIZON_DAYS, { in: inTz }),
    { in: inTz }
  );

  // WHY filter ruleId on the initial query (not after RRule): on-demand path must not
  // geocode or price unrelated rules when admin just created one Regelfahrt.
  let rulesQuery = supabase
    .from('recurring_rules')
    .select('*, billing_variants(billing_type_id)')
    .eq('is_active', true);

  if (options?.ruleId) {
    rulesQuery = rulesQuery.eq('id', options.ruleId);
  }
```

---

### G3 — Main generation loop

#### a. One rule at a time or batch?

**One rule at a time**, sequentially:

```typescript
  for (const rule of rules) {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', rule.client_id)
      .single();
```

Within each rule, **one RRule occurrence at a time**:

```typescript
    for (const dateUTC of occurrencesUTC) {
      const dateStr = instantToYmdInBusinessTz(dateUTC.getTime());
```

#### b. Outbound first, then return?

**Yes — always outbound first, then return** (if `returnMode !== 'none'`):

```typescript
      const outboundId = await insertIfAbsent(outboundWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,
        leg: 'outbound'
      });

      if (!outboundId) continue;

      if (returnMode === 'none') continue;
      // ...
      const returnId = await insertIfAbsent(returnWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,
        leg: 'return'
      });
```

Return payload is built with `linkedTripId: outboundId` (outbound id known before return insert).

#### c. Supabase calls per outbound+return pair (happy path — both inserted)

| # | Operation | Table | When |
|---|-----------|-------|------|
| 1 | **SELECT** `id` | `trips` | `findExistingRecurringLegId` — outbound dedup |
| 2 | **INSERT** + SELECT `id` | `trips` | `insertIfAbsent` — new outbound |
| 3 | **SELECT** `id` | `trips` | `findExistingRecurringLegId` — return dedup |
| 4 | **INSERT** + SELECT `id` | `trips` | `insertIfAbsent` — new return (row includes `linked_trip_id: outboundId`) |
| 5 | **UPDATE** `linked_trip_id`, `link_type` | `trips` | Outbound row only — `.eq('id', outboundId)` |

**Minimum 5 Supabase round-trips** per occurrence (plus amortised rule/client/exception loads).

If both legs already exist: steps 1–4 collapse to two SELECTs (skip inserts); step 5 **still runs**.

#### d. Sequential or parallel?

**Fully sequential** — `await` inside nested `for` loops; no `Promise.all` on trip writes:

```typescript
  for (const rule of rules) {
    // ...
    for (const dateUTC of occurrencesUTC) {
      // ...
      const outboundId = await insertIfAbsent(outboundWithPrice, { ... });
      // ...
      const returnId = await insertIfAbsent(returnWithPrice, { ... });
      // ...
      const { error: linkOutError } = await supabase
        .from('trips')
        .update({ linked_trip_id: returnId, link_type: 'outbound' })
        .eq('id', outboundId);
    }
  }
```

---

## 2. Dedup logic — Bug A root cause

### D1 — `findExistingRecurringLegId` (verbatim)

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

#### a. Exact Supabase query

| Filter | Value |
|--------|-------|
| `select` | `id` |
| `client_id` | `eq` dedup key |
| `rule_id` | `eq` dedup key |
| `requested_date` | `eq` dedup key (Berlin YMD string, e.g. `'2026-06-23'`) |
| **Outbound leg** | `.or('link_type.is.null,link_type.eq.outbound')` |
| **Return leg** | `.eq('link_type', 'return')` |
| Terminal | `.maybeSingle()` |

**Critical:** SQL `NULL = '2026-06-23'` is unknown — rows with `requested_date IS NULL` **never match**.

#### b. `maybeSingle()` behaviour (Supabase / PostgREST)

| Rows matched | `data` | `error` |
|--------------|--------|---------|
| **0** | `null` | `null` |
| **1** | `{ id: '...' }` | `null` |
| **≥2** | `null` | PostgREST error — code **`PGRST116`**, message *"JSON object requested, multiple (or no) rows returned"* (wording may include row count) |

#### c. Function return value

| Case | Returns |
|------|---------|
| 0 rows | `null` (`!data`) |
| 1 row | `data.id` (string) |
| ≥2 rows | `null` (`error` truthy → `if (error \|\| !data) return null`) |

#### d. Downstream when `null` vs id

Called from `insertIfAbsent`:

```typescript
    const existing = await findExistingRecurringLegId(dedupKey);
    if (existing) {
      tripsSkipped++;
      return existing;
    }

    const { data, error } = await supabase
      .from('trips')
      .insert(row)
      .select('id')
      .single();
```

| `findExistingRecurringLegId` result | Effect |
|-------------------------------------|--------|
| **id string** | Skip insert; return existing id (used for linking) |
| **null** (0 rows, ≥2 rows, or query error) | **Proceed to INSERT** — duplicate created on ≥2-row ambiguity |

---

### D2 — `insertIfAbsent` (verbatim)

```typescript
  async function insertIfAbsent(
    row: TripInsert,
    dedupKey: {
      client_id: string;
      rule_id: string;
      requested_date: string;
      leg: 'outbound' | 'return';
    }
  ): Promise<string | null> {
    const existing = await findExistingRecurringLegId(dedupKey);
    if (existing) {
      tripsSkipped++;
      return existing;
    }

    const { data, error } = await supabase
      .from('trips')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      errorCount++;
      console.error('[generate-recurring-trips] insert failed:', error);
      return null;
    }
    tripsInserted++;
    return data.id;
  }
```

#### a. Row already exists (dedup hit)

Returns **existing id**; increments `tripsSkipped`; no insert.

#### b. New row inserted

Returns **`data.id`** from insert; increments `tripsInserted`.

#### c. On error

Increments `errorCount`; logs error; returns **`null`**.

#### d. Id used for linking?

**Yes.** Caller assigns:

```typescript
      const outboundId = await insertIfAbsent(outboundWithPrice, { ... });
      if (!outboundId) continue;
      // ...
      const returnPayload = await buildTripPayload({
        // ...
        linkedTripId: outboundId,
      });
      // ...
      const returnId = await insertIfAbsent(returnWithPrice, { ... });
      if (!returnId) continue;

      const { error: linkOutError } = await supabase
        .from('trips')
        .update({
          linked_trip_id: returnId,
          link_type: 'outbound'
        })
        .eq('id', outboundId);
```

If `insertIfAbsent` returns `null`, the occurrence is **skipped entirely** (no link update).

---

### D3 — Duplicate path: legacy `requested_date IS NULL` + cron re-run

**Setup:** DB has outbound `rule_id=R`, `client_id=C`, `requested_date=NULL`, `scheduled_at` set. Cron runs for Berlin date `dateStr = '2026-06-23'`.

**Step 1 — Build payload** (always sets Berlin YMD on new rows):

```typescript
      requested_date: dateStr,
```

**Step 2 — Outbound dedup lookup:**

```typescript
      const outboundId = await insertIfAbsent(outboundWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,  // '2026-06-23'
        leg: 'outbound'
      });
```

Inside `findExistingRecurringLegId`:

```typescript
      .eq('requested_date', q.requested_date);  // eq '2026-06-23'
```

Legacy row has `requested_date IS NULL` → **no match** → `data = null` → returns `null`.

**Step 3 — Insert proceeds:**

```typescript
    const { data, error } = await supabase
      .from('trips')
      .insert(row)
      .select('id')
      .single();
```

**Second duplicate row** created for same rule/client/calendar day.

**Step 4 — Return leg:** Same NULL vs YMD split can create a second return or attach to wrong outbound.

**Production example (Kira, 2026-06-23):**

| id | link_type | requested_date | scheduled_at | linked_trip_id |
|----|-----------|----------------|--------------|----------------|
| `5185b63f` | outbound | `2026-06-23` | 11:30 UTC | `null` |
| `54d92673` | outbound | **`NULL`** | 09:00 UTC | `null` |

Cron dedup key `requested_date: '2026-06-23'` matches `5185b63f` only; `54d92673` is invisible → further inserts possible.

---

### D4 — `maybeSingle()` ≥2 rows failure

**Error object:** PostgREST **`PGRST116`** — multiple rows for `.maybeSingle()`.

**Handling (verbatim):**

```typescript
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data.id;
```

- **Not logged** when `error` is set (distinct from insert failure logging).
- **Swallowed** — treated same as "not found".
- **Surfaces** only indirectly as extra `tripsInserted` count.

**Production ≥2-row case (Ingrid Schultz, NULL `requested_date`):**

```sql
SELECT rule_id, client_id, link_type, COUNT(*)
FROM trips
WHERE requested_date IS NULL AND rule_id IS NOT NULL
  AND status NOT IN ('cancelled','completed')
GROUP BY rule_id, client_id, link_type HAVING COUNT(*) > 1;
```

| rule_id | client_id | link_type | count |
|---------|-----------|-----------|-------|
| `0e23c4eb-...` | `73f7ab59-...` | outbound | **4** |
| `0e23c4eb-...` | `73f7ab59-...` | return | **3** |

Any dedup lookup that somehow matched multiple NULL rows would also fail open — but NULL `eq 'YYYY-MM-DD'` prevents match entirely (separate failure mode).

---

### D5 — Transactions / locking / race conditions

**No transaction** wraps `findExistingRecurringLegId` + `insert`.

**No advisory lock** on `(rule_id, client_id, requested_date, leg)`.

**Race:** Two concurrent `generateRecurringTrips()` runs (cron + on-demand):

1. Both SELECT → 0 rows  
2. Both INSERT → **two rows**  
3. Unique index absent → both succeed  

**Conclusion:** App-level dedup alone **cannot** guarantee safety under concurrency; **DB unique index is mandatory** for hard guarantee.

---

## 3. Linking logic — Bug B root cause

### L1 — Every UPDATE writing `linked_trip_id` / `link_type` in generator

**Only one UPDATE in the entire file:**

```typescript
      const { error: linkOutError } = await supabase
        .from('trips')
        .update({
          linked_trip_id: returnId,
          link_type: 'outbound'
        })
        .eq('id', outboundId);

      if (linkOutError) {
        errorCount++;
        console.error(
          '[generate-recurring-trips] outbound link update failed:',
          linkOutError
        );
      }
```

| Question | Answer |
|----------|--------|
| **a. Row updated** | **Outbound** (`outboundId`) |
| **b. Fields set** | `linked_trip_id: returnId`, `link_type: 'outbound'` |
| **c. Condition** | Runs whenever `outboundId` and `returnId` are both truthy after `insertIfAbsent` — **including when both legs already existed** |
| **d. Partner update** | **No** corresponding `UPDATE` on return row |

**INSERT-time link fields** (not UPDATE):

```typescript
      link_type,
      linked_trip_id: linkedTripId,
```

Return payload construction:

```typescript
      const returnPayload = await buildTripPayload({
        // ...
        linkedTripId: outboundId,
        outboundLinkType: null,
      });
```

→ New return rows get `link_type: 'return'`, `linked_trip_id: outboundId` **on insert**.

Outbound payload:

```typescript
        linkedTripId: null,
        outboundLinkType: null,
```

→ New outbound rows start with `linked_trip_id: null`; outbound pointer set only via UPDATE after return exists.

---

### L2 — Pairing step

#### a. After both ids — verbatim

```typescript
      const returnId = await insertIfAbsent(returnWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,
        leg: 'return'
      });

      if (!returnId) continue;

      const { error: linkOutError } = await supabase
        .from('trips')
        .update({
          linked_trip_id: returnId,
          link_type: 'outbound'
        })
        .eq('id', outboundId);

      if (linkOutError) {
        errorCount++;
        console.error(
          '[generate-recurring-trips] outbound link update failed:',
          linkOutError
        );
      }
```

#### b. Return already existed (`insertIfAbsent` returned existing id)

- **No UPDATE on return row.**
- Return keeps **stale** `linked_trip_id` from original insert (may point at a **different** outbound if duplicates exist).
- Outbound UPDATE **does** set `linked_trip_id: returnId` on **current** `outboundId`.

**Asymmetric graph** when duplicate outbounds exist: return → old outbound; new outbound → return; old outbound unlinked.

#### c. Outbound already existed

- Outbound UPDATE **always runs** — repoints `outboundId` to `returnId`.
- If return was **new insert**, return already has `linked_trip_id: outboundId` → **bidirectional OK**.
- If return **also existed** pointing elsewhere → **return not repointed**.

---

### L3 — Compare `create-linked-return.ts`

#### a. Linking section (verbatim)

```typescript
  const created = await tripsService.createTrip(insert);

  await tripsService.updateTrip(outbound.id, {
    linked_trip_id: created.id,
    link_type: 'outbound'
  });

  return created as Trip;
```

(`buildReturnTripInsert` sets on return insert: `link_type: 'return'`, `linked_trip_id: outbound.id`.)

#### b. Bidirectional?

**Effective yes for new pairs:**

| Leg | `linked_trip_id` | When |
|-----|------------------|------|
| Return (insert) | → outbound | Insert |
| Outbound (update) | → return | Immediately after |

#### c. Why materialiser differs?

Materialiser **copies the same partial pattern** (return on insert + outbound UPDATE) but:

1. Runs on **reused** rows via `insertIfAbsent` without repointing stale returns  
2. Never added return-side UPDATE when outbound identity changes  
3. Historical cron runs accumulated **415** one-way graphs  

Materialiser does **not** call `createLinkedReturnForOutbound` — inlined duplicate logic without shared link helper.

**Same one-way pattern elsewhere:**

- `duplicate-trips.ts` (lines 563–569): outbound UPDATE only after paired insert  
- `create-trip-form.tsx` (anonymous mode): return insert with `linked_trip_id: outbound.id`, **no outbound UPDATE**  
- Bulk upload Pass 3: outbound UPDATE only; Pass 4 (`pair_id`): **bidirectional** UPDATE  

---

### L4 — 416 broken links (DB)

#### a. Query result

```sql
SELECT
  t1.link_type,
  COUNT(*) AS broken_count,
  COUNT(CASE WHEN t2.id IS NULL THEN 1 END) AS partner_missing,
  COUNT(CASE WHEN t2.id IS NOT NULL AND (t2.linked_trip_id IS NULL OR t2.linked_trip_id != t1.id) THEN 1 END) AS partner_wrong_pointer
FROM trips t1
LEFT JOIN trips t2 ON t2.id = t1.linked_trip_id
WHERE t1.linked_trip_id IS NOT NULL
  AND t1.status NOT IN ('cancelled','completed')
  AND (t2.id IS NULL OR t2.linked_trip_id IS NULL OR t2.linked_trip_id != t1.id)
GROUP BY t1.link_type;
```

| link_type | broken_count | partner_missing | partner_wrong_pointer |
|-----------|--------------|-----------------|----------------------|
| **outbound** | **1** | **0** | **1** |
| **return** | **415** | **0** | **415** |
| **Total** | **416** | **0** | **416** |

#### b. Predominantly return or outbound?

**Predominantly return rows (415/416).** Pattern: return `linked_trip_id` → outbound, but outbound `linked_trip_id IS NULL` or points elsewhere.

#### c. Missing partners?

**partner_missing = 0** — all `linked_trip_id` targets exist; graph is **wrong pointer**, not orphan FK.

**Single broken outbound example:**

| outbound id | points to return | return points to |
|-------------|------------------|------------------|
| `ce65261b` | `fb03b9c2` | **`334d9281`** (different outbound) |

Duplicate-leg scenario (Ulrike/Kira class).

---

### L5 — All `linked_trip_id` **writes** in `src/`

| Location | What it writes | Both sides? |
|----------|------------------|-------------|
| **`recurring-trip-generator.ts`** INSERT | Return: `linked_trip_id: outboundId` | Return only on insert |
| **`recurring-trip-generator.ts`** UPDATE | Outbound: `linked_trip_id: returnId`, `link_type: 'outbound'` | Outbound only |
| **`create-linked-return.ts`** INSERT + UPDATE | Return insert → outbound; `updateTrip(outbound)` → return | **Yes** (new pairs) |
| **`build-return-trip-insert.ts`** INSERT | `linked_trip_id: outbound.id` on return | Return only |
| **`create-trip-form.tsx`** INSERT | Return rows: `linked_trip_id: outbound.id` | Return only — **no outbound UPDATE** in form |
| **`create-return-trip-dialog.tsx`** | Via `createLinkedReturnForOutbound` | **Yes** |
| **`duplicate-trips.ts`** INSERT + UPDATE | Return insert → outbound; outbound UPDATE → return | Same as generator |
| **`bulk-upload-dialog.tsx`** Pass 3 UPDATE | Outbound → return | Outbound only |
| **`bulk-upload-dialog.tsx`** Pass 4 UPDATE | **Both** hinfahrt + rueckfahrt | **Yes** (pair_id pairs) |
| **`bulk-upload-dialog.tsx`** INSERT | Return payload `linked_trip_id: outboundId` | Return only |
| **`trip-hard-delete.ts`** UPDATE | Sets `linked_trip_id: null` on deleted ids and inverse refs | Clears both directions |

**No write in `trips.service.ts`** — `createTrip` / `updateTrip` are generic passthrough; **no dedup**.

```typescript
  async createTrip(trip: InsertTrip) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('trips')
      .insert(trip)
      .select()
      .single();

    if (error) throw toQueryError(error);
    return data;
  },

  async updateTrip(id: string, trip: UpdateTrip) {
    const supabase = createClient();
    // ... pricing recalc optional ...
```

**No `upsertTrip`** in `trips.service.ts`.

---

## 4. Data repair safety

### R1 — Proposed link repair SQL

```sql
UPDATE trips t1
SET linked_trip_id = (
  SELECT t2.id FROM trips t2
  WHERE t2.rule_id = t1.rule_id
    AND t2.client_id = t1.client_id
    AND t2.requested_date = t1.requested_date
    AND t2.link_type != t1.link_type
    AND t2.status NOT IN ('cancelled','completed')
  ORDER BY t2.created_at DESC
  LIMIT 1
)
WHERE t1.linked_trip_id IS NOT NULL
  AND t1.status NOT IN ('cancelled','completed')
  AND EXISTS (
    SELECT 1 FROM trips t2
    WHERE t2.id = t1.linked_trip_id
      AND (t2.linked_trip_id IS NULL OR t2.linked_trip_id != t1.id)
  );
```

#### a. Multiple same-rule legs on same date?

**Yes — can mis-assign.** After backfill, Ingrid has **2 outbounds + 2 returns** on `2026-06-24`, `2026-06-25`, `2026-06-26` (simulated query below). Subquery picks **latest `created_at`** partner — may not match current `linked_trip_id` intent or driver assignment.

#### b. Kira — two outbounds, no return?

**2026-06-23:**

| id | link_type | requested_date | scheduled_at |
|----|-----------|----------------|--------------|
| `5185b63f` | outbound | `2026-06-23` | timed |
| `54d92673` | outbound | NULL → backfill `2026-06-23` | timed |

No return with `requested_date = 2026-06-23` linked to both. Subquery for a **return** row might pick unrelated return or NULL. For **outbound** repair, if no return exists → subquery **NULL** → sets `linked_trip_id = NULL` (may be desired for orphan outbound).

#### c. `requested_date` as join key with legacy NULL?

**Not reliable until backfill completes.** Repair must run **after** backfill, **after** duplicate merge. Rows with NULL `requested_date` cannot be paired by this SQL.

#### d. Safer repair (proposed)

```sql
-- Phase 1: Fix outbound pointers to match return's existing target (return is authoritative for cron)
UPDATE trips o
SET linked_trip_id = r.id,
    link_type = 'outbound'
FROM trips r
WHERE r.link_type = 'return'
  AND r.linked_trip_id = o.id
  AND r.status NOT IN ('cancelled','completed')
  AND o.status NOT IN ('cancelled','completed')
  AND (o.linked_trip_id IS DISTINCT FROM r.id OR o.link_type IS DISTINCT FROM 'outbound');

-- Phase 2: Fix return pointers where outbound.link_type = 'outbound' and points at return
UPDATE trips r
SET linked_trip_id = o.id,
    link_type = 'return'
FROM trips o
WHERE o.link_type = 'outbound'
  AND o.linked_trip_id = r.id
  AND r.status NOT IN ('cancelled','completed')
  AND o.status NOT IN ('cancelled','completed')
  AND (r.linked_trip_id IS DISTINCT FROM o.id OR r.link_type IS DISTINCT FROM 'return');
```

Run **after duplicate cleanup** so `linked_trip_id` on returns points at the **canonical** outbound.

**Simulated post-backfill duplicates (blocks naive repair + index):**

```sql
WITH simulated AS (
  SELECT id, rule_id, client_id, link_type,
    COALESCE(requested_date, DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')) AS eff_requested_date
  FROM trips
  WHERE rule_id IS NOT NULL AND status NOT IN ('cancelled','completed')
    AND (requested_date IS NOT NULL OR scheduled_at IS NOT NULL)
)
SELECT rule_id, eff_requested_date, client_id, link_type, COUNT(*)
FROM simulated
GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
```

| rule_id | eff_requested_date | client | link_type | count |
|---------|-------------------|--------|-----------|-------|
| Ingrid `0e23c4eb` | 2026-06-24 | … | outbound | **2** |
| Ingrid `0e23c4eb` | 2026-06-24 | … | return | **2** |
| Ingrid `0e23c4eb` | 2026-06-25 | … | outbound | **2** |
| Ingrid `0e23c4eb` | 2026-06-25 | … | return | **2** |
| Ingrid `0e23c4eb` | 2026-06-26 | … | outbound | **2** |
| Ingrid `0e23c4eb` | 2026-06-26 | … | return | **2** |
| Kira `75ad95e1` | 2026-06-23 | … | outbound | **2** |
| Ulrike `d33aab3a` | 2026-06-23 | … | outbound | **2** |

---

### R2 — Unique index pre-flight

#### a. Pre-flight (current DB — `requested_date IS NOT NULL`)

```sql
SELECT rule_id, requested_date, client_id, link_type, COUNT(*)
FROM trips
WHERE requested_date IS NOT NULL
  AND status NOT IN ('cancelled','completed')
  AND rule_id IS NOT NULL
GROUP BY rule_id, requested_date, client_id, link_type
HAVING COUNT(*) > 1;
```

**Result:** **`[]` (zero rows)** — no duplicates among rows that already have `requested_date`.

#### b. Would index creation block today?

**Not on current non-NULL data.** Duplicates live in **`requested_date IS NULL`** bucket (Ingrid 4+3 legs) and will **appear after backfill** (simulated query above → **8 conflict groups**).

#### c. Cleanup before index

1. **`requested_date` backfill** (timezone audit approved)  
2. **Merge/delete duplicate active legs** (Ingrid, Kira, Ulrike) — pick canonical row per `(rule_id, client_id, eff_requested_date, link_type)`  
3. **Re-run pre-flight** on simulated/backfilled data  
4. **Then** `CREATE UNIQUE INDEX ...`

Proposed index:

```sql
CREATE UNIQUE INDEX trips_rule_leg_unique
ON trips (rule_id, requested_date, client_id, link_type)
WHERE requested_date IS NOT NULL
  AND status NOT IN ('cancelled', 'completed');
```

**Note:** Partial index excludes `requested_date IS NULL` — cron must never ship NULL `requested_date` on new rule trips after v4.

---

## 5. Senior diagnosis + deployment sequence

### S1 — Dedup fix scope + unique index necessity

| Layer | Required change |
|-------|-----------------|
| **`findExistingRecurringLegId`** | Replace `.maybeSingle()` with `.limit(2)` + explicit ≥2 handling; add NULL-legacy fallback (`scheduled_at` Berlin date or OR clause) |
| **`insertIfAbsent`** | Consider `ON CONFLICT` once index exists |
| **Loop structure** | Sequential loop is fine; **logic** must handle reused ids + linking |

**Concurrent cron:** Hardened dedup **reduces** duplicates; **cannot eliminate** race without **unique index** (or serialisable transaction + `SELECT FOR UPDATE`).

**Verdict:** **Unique index mandatory** for production safety; app fix alone insufficient.

---

### S2 — Bidirectional link fix

**Adding return UPDATE after existing outbound UPDATE is necessary but not sufficient alone.**

Return row **always exists** at line 634 (`if (!returnId) continue`) before link block.

**Fix location — insert after outbound UPDATE (after line 642, before closing `}` of occurrence loop):**

```typescript
      const { error: linkOutError } = await supabase
        .from('trips')
        .update({
          linked_trip_id: returnId,
          link_type: 'outbound'
        })
        .eq('id', outboundId);
      // ← INSERT FIX HERE: UPDATE return SET linked_trip_id = outboundId, link_type = 'return' WHERE id = returnId
```

Also repoint return when **`insertIfAbsent` reused stale return** pointing at wrong outbound.

Extract shared **`linkRecurringPair(outboundId, returnId)`** mirroring bulk-upload Pass 4.

---

### S3 — Other fragile patterns (beyond A & B)

| # | Pattern | Risk |
|---|---------|------|
| 1 | **No transaction** on insert+link | Partial pair on mid-flight failure |
| 2 | **Link update runs even when both skipped** | May overwrite manual dispatcher link corrections |
| 3 | **`findExistingRecurringLegId` silent error swallow** | DB errors masquerade as "insert new" |
| 4 | **Outbound dedup OR** `link_type.is.null,link_type.eq.outbound` | Does not exclude `link_type = 'return'` mis-tagged rows if any |
| 5 | **Geocoding/pricing failures** skip rule/client silently (`continue`) | Silent non-generation |
| 6 | **Horizon 14 days + daily cron** | Duplicate amplification daily until dedup fixed |
| 7 | **Return timeless + duplicate outbounds** | Multiple returns/orphans (Ingrid 2026-06-23: return `b7fba5af` assigned, duplicate outbound `7e0da8aa` pending) |

---

### S4 — Minimal safe deployment sequence

| Step | Action | Justification |
|------|--------|---------------|
| **1** | **Deploy hardened generator** (dedup + bidirectional link helper) | **Stop bleeding** — no new duplicates/links on next cron |
| **2** | **Run `requested_date` backfill SQL** | Unifies dedup key; safe per timezone audit (9 NULL+scheduled rows) |
| **3** | **Clean up duplicate active rows** (Ingrid/Kira/Ulrike) | Simulated post-backfill conflicts **block index**; naive link repair unsafe |
| **4** | **Run two-phase link repair SQL** (§R1d) | Fix 416 broken graphs after canonical rows exist |
| **5** | **Create unique partial index** | Hard guarantee against concurrency + NULL-key splits |
| **6** | **Re-run cron once** (or on-demand per rule) | Verify skipped counts; no new duplicates |

**Do not create index before step 3** — backfill alone creates duplicate key collisions.

**Do not run original §R1 repair before step 3** — `ORDER BY created_at DESC` picks wrong partner when duplicates exist.

---

## v4a Resolution

Date: 2026-06-23

**Bug A (dedup fails open)**

- Fixed: `findExistingRecurringLegId` — replaced `.maybeSingle()` with `.limit(2)`, explicit ≥2 handling (return latest `created_at`), error logging with full dedup key.
- File: `src/lib/recurring-trip-generator.ts`

**Bug B (one-way linking)**

- Fixed: return-side UPDATE added after outbound UPDATE in occurrence loop (~line 650).
- Approach 1 (inline) per [`v4a-linking-approach-recommendation.md`](v4a-linking-approach-recommendation.md). v5c will extract `linkTripPairBidirectional()`.

**Backfill (pre-deploy)**

- Ran active-rows-only SQL (`status NOT IN ('cancelled', 'completed')`). Result: **0 rows updated** (NULL+scheduled candidates already backfilled).

**Unique index**

- Migration file: `supabase/migrations/20260623231715_trips_rule_leg_unique_index.sql`
- **Status: NOT applied** — pre-flight returned **5 duplicate groups** (Ingrid Schultz 2026-06-25/26 outbound+return; Kira 2026-06-23 outbound). Duplicate merge required before `CREATE UNIQUE INDEX`. See [`docs/recurring-trip-generator.md`](../recurring-trip-generator.md).

**Smoke test (post-code deploy)**

- `generateRecurringTrips()` local run (2026-06-23): `{ generated: 1, skipped: 173, errors: 0 }`.
- ≥2 dedup warnings logged for Kira 2026-06-23 outbound and Ingrid 2026-06-25/26 outbound+return (expected until duplicate merge).
- **1 insert** still occurred — investigate which rule/date leg was inserted before production deploy; after duplicate merge + index, expect `generated: 0` on re-run.

**Overall status:** Code **CLOSED** — index **BLOCKED** on duplicate merge. Monitor cron for `tripsInserted > 0` on re-runs after duplicate cleanup + index apply.

**Post-v4a follow-up:** duplicate merge; two-phase link-repair SQL (§R1d above); then apply index and re-run pre-flight.

*Audit complete. Full generator file: 660 lines read. No code or data changes made.*
