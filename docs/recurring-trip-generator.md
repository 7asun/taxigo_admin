# Recurring trip generator — contracts

Server-only materialisation in [`src/lib/recurring-trip-generator.ts`](../src/lib/recurring-trip-generator.ts). Invoked by:

- Vercel cron: `GET /api/cron/generate-recurring-trips`
- On-demand: [`recurring-rules.actions.ts`](../src/features/trips/api/recurring-rules.actions.ts) (`generateRecurringTrips({ ruleId })`)

Horizon: `RECURRING_TRIP_GENERATION_HORIZON_DAYS` (14 Berlin calendar days forward).

---

## Dedup contract

- **`requested_date`** on new rule trips must be a Berlin civil **YYYY-MM-DD** string (`instantToYmdInBusinessTz` on each RRule occurrence).
- **`findExistingRecurringLegId`** keys on `(client_id, rule_id, requested_date, leg)` where `leg` is `'outbound'` (`link_type IS NULL OR outbound`) or `'return'` (`link_type = return`).
- Rows with **`requested_date IS NULL`** are invisible to dedup (SQL `NULL ≠ 'YYYY-MM-DD'`). Legacy NULL rows must be backfilled before dedup/index can protect them.

### Legacy backfill (active rows only)

Run **before** deploying hardened generator code:

```sql
UPDATE trips
SET requested_date = DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')
WHERE rule_id IS NOT NULL
  AND requested_date IS NULL
  AND scheduled_at IS NOT NULL
  AND status NOT IN ('cancelled', 'completed');
```

Do **not** backfill cancelled/completed historical legs — harmless for the index but unnecessary mutation.

### v4a dedup behaviour

- Uses `.limit(2)` (not `.maybeSingle()`) — no PGRST116 fail-open.
- **0 rows** → insert proceeds.
- **1 row** → skip insert, reuse id.
- **≥2 rows** → log warning, return latest `created_at` id (skip insert until duplicates merged).
- Query errors → logged with full key context.

---

## Linking contract

After both `outboundId` and `returnId` exist for an occurrence:

1. **Outbound UPDATE:** `linked_trip_id = returnId`, `link_type = 'outbound'`
2. **Return UPDATE (v4a):** `linked_trip_id = outboundId`, `link_type = 'return'`

Both updates run on **every** successful pairing — new or reused via `insertIfAbsent`. The return UPDATE repoints stale pointers when dedup returns an existing return that still linked to an old duplicate outbound.

**Scope:** Cron repairs pairs that **re-enter the generation window**. Existing broken links outside the horizon require the two-phase SQL in [`docs/plans/v4-generator-audit.md`](plans/v4-generator-audit.md) §R1d (separate data-repair step).

v5c will centralise this in `linkTripPairBidirectional()` — not extracted in v4a.

---

## Concurrency contract

**App dedup** is defence-in-depth. **Hard guarantee** is the partial unique index:

```sql
CREATE UNIQUE INDEX trips_rule_leg_unique
  ON trips (rule_id, requested_date, client_id, link_type)
  WHERE requested_date IS NOT NULL
    AND status NOT IN ('cancelled', 'completed');
```

Migration: `supabase/migrations/20260623231715_trips_rule_leg_unique_index.sql`

**Apply only after** pre-flight returns zero duplicate groups:

```sql
SELECT rule_id, requested_date, client_id, link_type, COUNT(*)
FROM trips
WHERE requested_date IS NOT NULL
  AND status NOT IN ('cancelled', 'completed')
  AND rule_id IS NOT NULL
GROUP BY rule_id, requested_date, client_id, link_type
HAVING COUNT(*) > 1;
```

**Known limitation:** PostgreSQL treats `NULL` in `link_type` as distinct — two active outbounds with `link_type IS NULL` on the same key would not violate the index. Cron outbound UPDATE sets `link_type = 'outbound'` on each pairing.

---

## Deployment order

1. Backfill (active rows only)
2. Deploy generator code (v4a)
3. Pre-flight SELECT
4. Apply unique index (only if pre-flight empty)
5. Cron smoke test (`generated: 0`, high `skipped`, `errors: 0` on re-run)

**Post-v4a (do not skip):** duplicate merge (Ingrid/Kira) if pre-flight fails; two-phase link-repair SQL for 416 existing broken links.
