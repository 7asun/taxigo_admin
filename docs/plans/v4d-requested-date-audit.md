# v4d Audit — `requested_date` Integrity

Date: 2026-06-24  
Scope: Read-only audit (SQL + code). No migrations, no code changes.  
Database: TaxiGo Admin Dashboard (`etwluibddvljuhkxjkxs`, eu-central-1)

---

## Executive summary

The prompt assumed ~250 rows with `requested_date IS NULL` are uniformly “orphaned.” Live data shows **277** such rows. **268 have `scheduled_at` set** — for most of these, `requested_date = NULL` is **intentional application state** (timed trip), not missing data. Only **9 rows are truly anchorless** (`scheduled_at` and `requested_date` both NULL); all 9 are **CSV bulk-upload auto-return stubs** (`link_type = 'return'`).

**Zero** orphaned rows come from the recurring cron (`rule_id IS NOT NULL` count = 0 in Q1).

New orphans are **still being created** (6 in the last 7 days) — not purely historical. Recent rows are timed **return legs** created without `requested_date` (`buildReturnTripInsert` gap).

A CHECK constraint `(scheduled_at IS NOT NULL OR requested_date IS NOT NULL)` is **not safe to add yet** — bulk-upload return creation and reschedule-with-empty-date can violate it.

---

## SQL Findings (Q1–Q6)

### Q1 — Overall breakdown

| Metric | Value |
|--------|------:|
| `total_orphaned` (`requested_date IS NULL`) | **277** |
| `has_scheduled_at` | **268** |
| `no_scheduled_at` | **9** |
| `timed_with_rule` | **0** |
| `timeless_with_rule` | **0** |
| `completely_anchorless` (both NULL, no rule) | **9** |
| `oldest_row` | 2026-03-20 09:36:04 UTC |
| `newest_row` | 2026-06-24 12:54:51 UTC |

> Note: Prompt cited ~250 rows; current count is **277** (+27).

### Q2 — Status distribution

| status | n |
|--------|--:|
| assigned | 251 |
| pending | 19 |
| cancelled | 7 |

### Q3 — Completely anchorless sample (all 9 rows)

Every anchorless row matches this pattern:

| id (prefix) | status | scheduled_at | rule_id | link_type | linked_trip_id |
|-------------|--------|--------------|---------|-----------|----------------|
| c9422dbf… | assigned | NULL | NULL | **return** | set |
| 6855c6bb… | pending | NULL | NULL | **return** | set |
| … (7 more) | mixed | NULL | NULL | **return** | set |

Full list: 9 rows, all `link_type = 'return'`, all `ingestion_source = null`, created 2026-03-20 → 2026-03-27.

**Interpretation:** Bulk CSV Pass 2 inserts return legs via `buildReturnTrip()` with **both** schedule fields nulled before insert (see Code Q10).

### Q4 — Sample rows with `scheduled_at` but `requested_date` NULL (20-row sample)

Representative pattern:

| scheduled_at (UTC) | status | rule_id | created_at |
|--------------------|--------|---------|------------|
| 2026-03-27 14:00:00+00 | assigned | NULL | 2026-03-26 |
| 2026-06-25 11:00:00+00 | pending | NULL | **2026-06-24** |
| 2026-06-22 11:00:00+00 | assigned | NULL | 2026-06-21 |

All sampled rows have `rule_id = NULL`. These are **timed manual / linked trips** with a valid calendar anchor via `scheduled_at`. Berlin YMD extraction via `instantToYmdInBusinessTz` is well-defined for repair **if** product wants `requested_date` denormalized on timed rows.

### Q5 — New orphans (last 7 days)

| new_orphans_last_7_days |
|------------------------:|
| **6** |

Supplementary query on those 6 rows: **all** have `scheduled_at` set, **all** `link_type = 'return'`, `ingestion_source = null`. Examples:

- `86f0f04d…` — 2026-06-24, return, `scheduled_at = 2026-06-25 11:00:00+00`
- `2385befe…` — 2026-06-23, return, timed

**Conclusion:** Problem is **not purely historical**. Ongoing paths (manual linked return create, v4c/reschedule timed writes clearing `requested_date`) still produce `requested_date IS NULL` rows — mostly **valid timed state**, plus return-leg omission.

### Q6 — Origin proxy

| origin_proxy | n |
|--------------|--:|
| manual_create | 162 |
| manual_link | 115 |
| cron | **0** |

Proxy definition: `rule_id IS NOT NULL` → cron; else `linked_trip_id IS NOT NULL` → manual_link; else manual_create.

Cron generator is **not** a source of `requested_date IS NULL` rows in production data.

---

## Code Findings (Q7–Q10)

### Q7 — Does `recurring-trip-generator.ts` always set `requested_date`?

**Yes.** Every generated leg payload includes `requested_date: dateStr` (Berlin business YMD for the materialization day):

```314:314:src/lib/recurring-trip-generator.ts
      requested_date: dateStr,
```

This is set **before** `scheduled_at: scheduledAtIso` (L333). Return legs with `returnMode === 'time_tbd'` may have `scheduledAtIso = null` (L617–628) but still carry `requested_date: dateStr`.

Dedup queries also key on `requested_date` (L355–363, L602, L668). **No generator gap identified.**

### Q8 — Manual creation: is at least one of `scheduled_at` / `requested_date` always set?

| Entry point | File | Sets anchor? | Notes |
|-------------|------|--------------|-------|
| **Neue Fahrt** | `create-trip-form.tsx` L1238–1244 → `combineDepartureForTripInsert` | **Yes** (when form valid) | Zod requires `departure_date` (`schema.ts` L20–23). Empty time → `{ scheduled_at: null, requested_date: ymd }`. With time → **both** set (`departure-schedule.ts` L46). |
| **CSV bulk outbound** | `bulk-upload-dialog.tsx` L329–354 `parseDateAndTime` | **Yes** | Valid date always yields `requestedDate: ymd`; optional time adds `scheduledAtIso`. |
| **CSV bulk auto-return** | `bulk-upload-dialog.tsx` L534–540 `buildReturnTrip` | **No — gap** | Explicitly `scheduled_at: null, requested_date: null` stub; matches Q3 anchorless rows. |
| **Manual Rückfahrt dialog** | `create-return-trip-dialog.tsx` → `buildReturnTripInsert` | **Partial** | Requires datetime (L98–100); sets `scheduled_at: params.scheduledAtIso` (L127) but **does not set `requested_date`**. Timed return legs are anchor-safe via `scheduled_at` only — explains recent 7-day orphans. |
| **Duplicate trips** | `derive-duplicate-schedules.ts` + `duplicate-trips.ts` | **Yes** | Schedules always include `requested_date` (often `targetDateYmd` or `instantToYmdInBusinessTz`). |
| **Detail sheet — first time on date-only** | `build-trip-details-patch.ts` L226–230, L244–245 | Timed only | Sets `scheduled_at` + **`requested_date: null`** — intentional promotion off date-only. |
| **v4c inline Zeit** | `scheduled-time-cell.tsx` L59–62 | Timed only | Same contract: `requested_date: null` on first-time time assignment. |

**Empty-date edge in helper (blocked at UI for create):**

```25:27:src/features/trips/lib/departure-schedule.ts
  if (!ymd) {
    return { scheduled_at: null, requested_date: null };
  }
```

Create-trip schema prevents empty `departure_date`; direct `tripsService.createTrip` could still bypass.

### Q9 — Reschedule dialog: always at least one field?

**Timed reschedule — yes, `scheduled_at` is guaranteed non-null:**

```56:65:src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx
function buildLeg(ymd: string, hm: string): LegScheduleInput {
  const hmTrim = hm.trim();
  if (hmTrim) {
    // ...
    const iso = buildScheduledAt(ymdTrim, hmTrim);
    return { scheduledAt: new Date(iso), requestedDate: null };
  }
```

`legToPatch` / `rowFromLeg` persist `{ scheduled_at: ISO, requested_date: null }` (L73–78, `reschedule.actions.ts` L32–37).

**Timeless reschedule — `requested_date` only if YMD non-empty:**

```67:70:src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx
  return {
    scheduledAt: null,
    requestedDate: ymd.trim() || null
  };
```

**Gap — both fields can be cleared:** UI only blocks “time without date” (`invalidPrimary`, L315–320). Submit is **not** blocked when **both** date and time are empty. That yields `{ scheduled_at: null, requested_date: null }` via `legToPatch` (L78).

**Clear-time in detail sheet — safe:** always sets `requested_date` when nulling `scheduled_at`:

```269:278:src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts
  if (
    trip.scheduled_at &&
    !input.timeDraft.trim() &&
    !('scheduled_at' in patch)
  ) {
    patch.scheduled_at = null;
    patch.requested_date =
      input.dateYmdDraft ||
      trip.requested_date ||
      instantToYmdInBusinessTz(new Date(trip.scheduled_at).getTime());
  }
```

**v4c clear-time — safe when `scheduled_at` existed:** `scheduled-time-cell.tsx` preserves YMD into `requested_date` (L77–86).

### Q10 — Paths that can produce BOTH NULL

| Path | Location | Mechanism |
|------|----------|-----------|
| **1. CSV auto-return stub** | `bulk-upload-dialog.tsx` L539–540 | `buildReturnTrip` zeros both fields before Pass 2 insert. **Confirmed in DB (9 rows).** |
| **2. Reschedule empty date + empty time** | `trip-reschedule-dialog.tsx` L67–70 + L73–78 | No validation preventing blank YMD + blank HM submit. |
| **3. `combineDepartureForTripInsert` empty/invalid YMD** | `departure-schedule.ts` L25–31 | Returns both null; blocked by create-trip Zod, not by DB. |
| **4. Direct service/API bypass** | `tripsService.createTrip` / `updateTrip` | No server-side invariant today. |

**Not a both-null path:** detail sheet clear-time, v4c clear-time (when prior `scheduled_at` exists), cron generator, duplicate flows, CSV outbound rows.

---

## Senior Recommendation (A–D)

### A — Repairability of “orphaned” rows

**Reframe:** `requested_date IS NULL` ≠ always broken.

1. **268 rows with `scheduled_at IS NOT NULL`**  
   - Calendar anchor exists via `scheduled_at`.  
   - **Do not treat as data corruption** — many are **by design** (reschedule timed, detail sheet / v4c first-time time assignment, manual returns without `requested_date`).  
   - **Optional denormalization backfill:**  
     `requested_date = instantToYmdInBusinessTz(extract(epoch from scheduled_at)::bigint * 1000)`  
     (or app helper equivalent) is **technically safe** for display/filter parity but **changes semantics** where product intentionally keeps `requested_date` null on timed trips. **Recommend product decision before bulk backfill.**  
   - Fahrten Datum column (v4c) already uses `parseScheduledAtOrFallback(scheduled_at)?.ymd ?? requested_date` — timed rows display correctly without backfill.

2. **9 anchorless rows (both NULL)**  
   - **Must be repaired** before any CHECK constraint.  
   - All are bulk-upload return stubs — repair from linked outbound leg:  
     `requested_date = COALESCE(outbound.requested_date, instantToYmdInBusinessTz(outbound.scheduled_at))`  
     and/or copy outbound schedule policy (time_tbd vs timed).  
   - If outbound is also broken, flag for manual review (none observed in Q3 sample).

### B — CHECK constraint safety

Proposed: `(scheduled_at IS NOT NULL OR requested_date IS NOT NULL)`

| Write path | Violates today? |
|------------|-----------------|
| Cron generator | No |
| Neue Fahrt (valid form) | No |
| CSV outbound | No |
| **CSV auto-return stub** | **Yes** (9 existing + any re-run) |
| **Manual return insert** (`buildReturnTripInsert`) | No *if* `scheduled_at` always set — but omits `requested_date` (allowed by CHECK) |
| Reschedule timed | No (`scheduled_at` set) |
| **Reschedule both empty** | **Yes** (possible today) |
| Detail sheet clear-time | **No** — always sets `requested_date` |
| v4c set time (date-only → timed) | No (`scheduled_at` set) |
| v4c clear time | **No** when `preservedYmd` present; **Yes** only if `preservedYmd` missing (edge: should not happen when clearing existing `scheduled_at`) |

**Verdict:** **Not safe to add constraint without code fixes first:**

1. Fix `buildReturnTrip` to inherit outbound calendar day (`requested_date` at minimum; optional return time from CSV policy).  
2. Fix `buildReturnTripInsert` to set `requested_date` from Berlin YMD of return `scheduled_at` (or outbound day for time_tbd returns).  
3. Block reschedule submit when both primary YMD and HM are empty (and same for partner leg).  
4. Repair 9 anchorless rows.

After fixes + repair, constraint should hold for all UI paths; consider server-side validation on API routes if direct Supabase client writes remain possible.

### C — DB vs application vs both

| Layer | Recommendation |
|-------|----------------|
| **Database CHECK** | Add **after** code fixes + one-time repair — enforces invariant for all clients (RLS inserts, future features, scripts). |
| **Application (Zod / patch builders)** | Add **now** in next slice — validate insert/update patches in `tripsService`, `build-trip-details-patch`, reschedule actions, bulk upload return builder. Catches errors before round-trip. |
| **Both** | **Preferred end state.** App layer gives UX messages; DB layer prevents silent corruption. |

Do **not** rely on Zod alone — bulk upload and reschedule already bypass a single schema.

### D — Migration file estimate

| # | Migration purpose |
|---|-------------------|
| **1** | **Data repair** — fix 9 anchorless return rows from outbound; optional separate backfill migration if product approves denormalizing `requested_date` on all 268 timed rows |
| **2** | **CHECK constraint** — `ALTER TABLE trips ADD CONSTRAINT trips_schedule_anchor_check CHECK (scheduled_at IS NOT NULL OR requested_date IS NOT NULL)` |

**Total: 2 migration files** (repair + constraint), delivered in one PR after application fixes.

If optional timed-row backfill is declined: **1 repair migration + 1 constraint migration** still (2 files). Code fixes are not migrations.

---

## Proposed repair SQL (draft only — do not run as migration yet)

### Step 1 — Repair anchorless bulk-upload return legs (9 rows)

```sql
-- Preview
SELECT
  r.id AS return_id,
  r.scheduled_at AS return_scheduled_at,
  r.requested_date AS return_requested_date,
  o.id AS outbound_id,
  o.scheduled_at AS outbound_scheduled_at,
  o.requested_date AS outbound_requested_date
FROM trips r
JOIN trips o ON o.id = r.linked_trip_id
WHERE r.requested_date IS NULL
  AND r.scheduled_at IS NULL
  AND r.link_type = 'return';

-- Draft update: give return leg the outbound calendar day
-- (Use Berlin TZ extraction in app/migration helper — below is conceptual;
--  prefer instantToYmdInBusinessTz in a TS migration script or plpgsql with AT TIME ZONE 'Europe/Berlin')
UPDATE trips r
SET requested_date = COALESCE(
  o.requested_date,
  (o.scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin')::date::text
)
FROM trips o
WHERE o.id = r.linked_trip_id
  AND r.requested_date IS NULL
  AND r.scheduled_at IS NULL
  AND r.link_type = 'return';
```

> **Review note:** Confirm `requested_date` column type (DATE vs TEXT YMD) before final SQL; project uses `YYYY-MM-DD` strings in app code.

### Step 2 — Optional denormalization (product approval required)

```sql
-- ONLY if product wants requested_date populated on all timed rows
UPDATE trips
SET requested_date = to_char(
  (scheduled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin')::date,
  'YYYY-MM-DD'
)
WHERE requested_date IS NULL
  AND scheduled_at IS NOT NULL;
```

**Risk:** Conflicts with intentional `requested_date = null` on timed trips; may affect filters/widgets that treat `requested_date IS NOT NULL AND scheduled_at IS NULL` as “timeless.” **Do not run without explicit product sign-off.**

### Step 3 — Constraint (after code + Step 1)

```sql
ALTER TABLE trips
  ADD CONSTRAINT trips_schedule_anchor_check
  CHECK (scheduled_at IS NOT NULL OR requested_date IS NOT NULL);
```

---

## Open questions for the human

1. **Semantic model:** Should **timed** trips (`scheduled_at` set) **always** carry a redundant `requested_date`, or is `requested_date = NULL` the canonical timed state (current reschedule / detail sheet / v4c behavior)?

2. **Backfill scope:** Repair only the **9 anchorless** rows, or also denormalize `requested_date` onto the **268 timed** rows?

3. **Return-leg policy:** For CSV / manual returns, should `requested_date` mirror outbound’s day, or the return’s own `scheduled_at` Berlin day when timed?

4. **Reschedule UX:** Should empty date **and** empty time be forbidden outright, or should it delete/archive the trip instead of writing both NULL?

5. **Constraint timing:** OK to ship code fixes in v4d application PR first, then repair migration + CHECK in a follow-up deploy window?

---

## Key code references

| Topic | File | Lines |
|-------|------|------:|
| Berlin YMD from instant | `trip-business-date.ts` | 25–31 |
| Build / parse schedule | `trip-time.ts` | 86–198 |
| First-time + clear-time patch | `build-trip-details-patch.ts` | 214–278 |
| Cron always sets `requested_date` | `recurring-trip-generator.ts` | 314, 333 |
| Reschedule leg → patch | `trip-reschedule-dialog.tsx` | 56–78 |
| Reschedule server patch | `reschedule.actions.ts` | 28–42 |
| Create-trip departure combine | `departure-schedule.ts` | 20–46 |
| Bulk return both-null stub | `bulk-upload-dialog.tsx` | 534–540 |
| Manual return insert | `build-return-trip-insert.ts` | 127–128 |
| v4c first-time clears `requested_date` | `scheduled-time-cell.tsx` | 59–62 |

---

## Bulk Upload Return Leg Gap

Follow-up audit on **Gap 1**: the 9 anchorless rows (`scheduled_at` and `requested_date` both NULL) from bulk CSV auto-return creation. Code-only investigation; no migrations.

> **Note on prompt file paths:** `buildReturnTrip` is a **local function** inside `bulk-upload-dialog.tsx` (not imported). `buildReturnTripInsert` lives at `src/features/trips/lib/build-return-trip-insert.ts` (not under `trip-reschedule/`). `instantToYmdInBusinessTz` is in `trip-business-date.ts` (not `trip-time.ts` L86–153, which covers `buildScheduledAt` / `buildScheduledAtOrNull`).

### Q1 — Two-pass structure

Bulk insert runs inside `runBulkInsert()` (nested in `processCsv` → `Papa.parse` `complete` handler, L1108+).

| Pass | What | Lines |
|------|------|------:|
| **0** | Geocode outbound rows + driving metrics | L1113–1248 |
| **0b** | Pricing contexts | L1254–1293 |
| **1** | `bulkCreateTrips(pricedOutboundTrips)` — outbound inserts | L1325–1327 |
| **2** | Build + `bulkCreateTrips(returnTripPayloads)` — auto-return legs | L1329–1409 |
| **3** | Backfill outbound `linked_trip_id` + `link_type = 'outbound'` | L1411–1427 |
| **4** | Link explicit CSV `pair_id` pairs (UPDATE only, no new rows) | L1430–1536 |

Pass 2 runs in the **same async function** as Pass 1 (`runBulkInsert`), immediately after Pass 1 completes, inside one `try` block (L1324–1617).

**Conditions that skip Pass 2 for a row:**

| Condition | Lines | Effect |
|-----------|------:|--------|
| `!row.needsReturnTrip` | L1344 | Row skipped — no return payload |
| `!createdOutbound[i]` | L1344 | Outbound insert missing for index — skip |
| `pricedOutboundTrips.length === 0 \|\| errors.length > 0` | L1323 | Entire Pass 1–4 block skipped |
| `pairId && rowNeedsReturnTrip` → `rowNeedsReturnTrip = false` | L1088–1090 | Auto-return suppressed when CSV `pair_id` present (Pass 4 links instead) |

**`needsReturnTrip` is set when** billing behavior `returnPolicy === 'time_tbd' \|\| 'exact'` (L519–520, L1054).

Pass 2 **does run** for billing types with auto-return policy — evidenced by the 9 DB rows (return legs exist, `linked_trip_id` set).

### Q2 — What `buildReturnTrip` does with schedule fields

**Answer: (a) Intentionally zeros both fields** — not a failed copy, not a Pass-2 control-flow bug.

```534:540:src/features/trips/components/bulk-upload-dialog.tsx
  const buildReturnTrip = (
    outbound: InsertTrip,
    outboundId: string
  ): InsertTrip => ({
    ...outbound,
    scheduled_at: null,
    requested_date: null,
```

The spread `...outbound` first inherits outbound schedule, then **explicit overrides** null both fields. Comment L525–532 describes address swap and metric recalculation; it does **not** document schedule inheritance. There is no attempt to copy or derive schedule — the null assignments are deliberate in current code.

Design intent (inferred): “Zeitabsprache” placeholder return (`time_tbd` policy) with no clock time. **Bug:** clearing `requested_date` removes the calendar anchor entirely instead of copying outbound’s `requested_date` (date-only return on same day).

### Q3 — Error handling / silent failure

Pass 1–4 share one `try/catch` (L1324–1627):

```1617:1626:src/features/trips/components/bulk-upload-dialog.tsx
            } catch (e: any) {
              errors.push(`Datenbankfehler: ${e.message}`);
              setResults({
                success: 0,
                errors,
                rows: validatedRows,
                returnTripsCreated: 0,
```

- **If Pass 2 `bulkCreateTrips` throws:** user sees `Datenbankfehler: …` in results; toast success path not reached. **Not silent.**
- **Partial failure risk:** if Pass 1 succeeds and Pass 2 throws, catch reports `success: 0` but outbound rows may already exist in DB (no transaction rollback).
- **Per-row skip** (`!needsReturnTrip`): silent skip — by design, not an error.
- **Metrics fetch failures** inside Pass 2 loop: caught non-fatally (L1368–1370); insert still proceeds.

The 9 anchorless rows prove Pass 2 **completed successfully** — inserts ran, not swallowed errors.

### Q4 — Schedule info available at `buildReturnTrip` call site

Call site (L1344–1346):

```typescript
const outboundId = createdOutbound[i].id as string;
const payload = buildReturnTrip(outboundTrips[i], outboundId);
```

`outboundTrips[i]` is the **pre-insert outbound payload** from `successfulRows` (L1250–1252), built from CSV via `parseDateAndTime` (L912–929):

- `scheduled_at`: UTC ISO when CSV had time, else `null`
- `requested_date`: always set to Berlin YMD when CSV date valid (L342–343, L354)

At call time the code also has `createdOutbound[i]` (DB row with same schedule fields) but **does not pass it** to `buildReturnTrip`. Outbound schedule is fully available on `outbound` argument; the function chooses to discard it.

### Q5 — Code changes since 2026-03-20 → 2026-03-27 row creation window

`git blame` on L534–540:

| Commit | Date | Change |
|--------|------|--------|
| `ae30ed13` | **2026-03-17** | Introduced `buildReturnTrip` with `scheduled_at: null, requested_date: null` |
| `1d968a25` | 2026-03-18 | Grouping nulls only |

No subsequent commit modified the schedule-null lines. Latest touch on file: `e013665` 2026-06-14 (KTS) — unrelated to `buildReturnTrip` schedule.

**Verdict:** Same both-null path is **still reachable today**. Any bulk upload with `returnPolicy` `time_tbd` or `exact` will create anchorless return legs until fixed. No partial fix applied.

*(No new anchorless bulk returns observed after March in DB — likely no bulk uploads with auto-return policy since then, not because code was fixed.)*

### Q6 — `buildReturnTripInsert` (manual dialog)

File: `src/features/trips/lib/build-return-trip-insert.ts`

**a) `requested_date` missing from insert?**  
**Yes.** Return object sets `scheduled_at: params.scheduledAtIso` (L127) but **never sets `requested_date`**.

**b) Same pattern as bulk?**  
**No — different gap:**

| Path | `scheduled_at` | `requested_date` | Anchorless? |
|------|----------------|------------------|-------------|
| Bulk `buildReturnTrip` | NULL | NULL | **Yes** |
| Manual `buildReturnTripInsert` | ISO (required by dialog) | omitted → NULL | **No** (timed anchor exists) |

**c) What’s in scope to derive `requested_date`?**  
`params.scheduledAtIso` is always set when dialog submits (`create-return-trip-dialog.tsx` L98–134 builds it via `buildScheduledAt`). Derive:

```typescript
import { instantToYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';

requested_date: instantToYmdInBusinessTz(new Date(params.scheduledAtIso).getTime())
```

Safe: dialog requires datetime; ISO comes from `buildScheduledAt` (Berlin contract).

### Q7 — All return-leg creation paths

| # | Call site | File | Schedule on return |
|---|-----------|------|-------------------|
| 1 | `buildReturnTrip(outboundTrips[i], outboundId)` | `bulk-upload-dialog.tsx` L1346 | **Both NULL** (bug) |
| 2 | `buildReturnTripInsert` → `tripsService.createTrip` | `create-linked-return.ts` L47–56 | `scheduled_at` only |
| 3 | `CreateReturnTripDialog` → `createLinkedReturnForOutbound` | `create-return-trip-dialog.tsx` L168–175 | via #2 |
| 4 | Inline `createTrip({ link_type: 'return', … })` | `create-trip-form.tsx` L1485–1486, L1664–1665 | **Both set** (`returnScheduledAt` + `returnRequestedDate`) |
| 5 | `buildDuplicateInsert` + `retSchedule` | `duplicate-trips.ts` L538–557 | From `deriveDuplicateSchedules` — always has `requested_date` |
| 6 | `buildTripPayload` + `insertIfAbsent` | `recurring-trip-generator.ts` L630–670 | Always `requested_date: dateStr`; `scheduled_at` may be null (TBD) |
| 7 | Pass 4 UPDATE only | `bulk-upload-dialog.tsx` L1524–1530 | Links existing rows — no insert |

**Shared gap:** only **#1** (both-null) and **#2/#3** (missing `requested_date` on timed return). Paths #4–#6 set at least one anchor correctly.

---

### Senior recommendation (Gap 1)

#### A — Which scenario?

**Pass 2 fires but stubs both fields intentionally (variant of hypothesis a).**

Evidence:

1. DB: 9 return rows exist with `link_type = 'return'`, `linked_trip_id` set → Pass 2 inserted them.
2. Code: L539–540 explicitly assign both NULL after spreading outbound.
3. Git: unchanged since 2026-03-17 introduction.
4. Not (b): no copy-then-fail logic exists.
5. Not “Pass 2 never fires”: rows would not exist.

The implementation matches an undocumented “empty placeholder” stub, but it violates the schedule-anchor invariant.

#### B — Ongoing or historical?

**Ongoing in code; historical in observed data.**

- Code path unchanged and reachable on every qualifying bulk upload.
- All 9 anchorless rows created 2026-03-20 → 2026-03-27; none since — **no recent bulk auto-return usage**, not a code fix.
- Re-uploading the same CSV today would **recreate the bug** (new rows, not repair old ones).

#### C — Minimal fixes

**1. Bulk `buildReturnTrip`**

Copy outbound calendar day; keep `scheduled_at` null for `time_tbd`:

```typescript
// bulk-upload-dialog.tsx — inside buildReturnTrip return object
scheduled_at: null,
requested_date: outbound.requested_date ?? (
  outbound.scheduled_at
    ? instantToYmdInBusinessTz(new Date(outbound.scheduled_at).getTime())
    : null
),
```

- **`time_tbd`:** date-only return on outbound’s Berlin day — matches create-trip “Rückfahrt mit Zeitabsprache”.
- **`exact` policy:** CSV has no separate return clock in this flow; same date-only return is the minimal safe fix until CSV return-time column exists. If product later adds return time, use `buildScheduledAt` here.

Import `instantToYmdInBusinessTz` from `@/features/trips/lib/trip-business-date`.

**2. `buildReturnTripInsert` (manual dialog)**

One field addition:

```typescript
// build-return-trip-insert.ts — in return object
scheduled_at: params.scheduledAtIso,
requested_date: instantToYmdInBusinessTz(new Date(params.scheduledAtIso).getTime()),
```

Correct and safe: dialog always supplies Berlin-wall ISO via `buildScheduledAt`.

#### D — Data repair vs re-upload

**The 9 rows still need a one-time data repair migration.**

Re-running bulk upload will:

- Insert **new** trip rows (new UUIDs)
- Leave the 9 broken rows in place
- Not update existing return legs

Repair SQL (from main audit) remains required: copy calendar day from linked outbound.

#### E — Revised v4d file touch count

| Slice | Files |
|-------|------:|
| Bulk upload fix | `bulk-upload-dialog.tsx` |
| Manual return fix | `build-return-trip-insert.ts` |
| Reschedule empty-submit guard (Gap from main audit) | `trip-reschedule-dialog.tsx` |
| Optional app validation | `departure-schedule.ts` or shared patch validator |
| Data repair migration | `supabase/migrations/…_repair_anchorless_returns.sql` |
| CHECK constraint migration | `supabase/migrations/…_trips_schedule_anchor_check.sql` |
| Docs | `docs/plans/v4d-implementation.md` (new), update `v4d-requested-date-audit.md` |

**Total: 7–8 files** (5–6 code + 2 migrations + docs), up from main audit’s 2-migration estimate by adding **2 application files** for Gap 1 + Gap 2 (bulk + manual return).

Optional tests: `build-return-trip-insert` unit test, bulk upload behavior test — not counted unless requested.

---

### Minimal fix sketch (reference only)

**Bulk — replace L539–540:**

```typescript
scheduled_at: null,
requested_date:
  outbound.requested_date ??
  (outbound.scheduled_at
    ? instantToYmdInBusinessTz(new Date(outbound.scheduled_at).getTime())
    : null),
```

**Manual — after L127:**

```typescript
scheduled_at: params.scheduledAtIso,
requested_date: instantToYmdInBusinessTz(
  new Date(params.scheduledAtIso).getTime()
),
```

**Repair (9 rows) — unchanged from main audit § Proposed repair SQL Step 1.**

---

## v4d Phase 1 Resolution

Date: 2026-06-24  
Status: **CLOSED (Phase 1)**

- Gap 1 (bulk `buildReturnTrip`): **FIXED**
- Gap 2 (`buildReturnTripInsert`): **FIXED**
- Data repair (9 rows): **APPLIED** — migration `20260624120000_repair_anchorless_return_legs.sql`; post-repair anchorless count = 0
- Ongoing leak: **STOPPED**
- Phase 2 deferred: reschedule guard + CHECK constraint → **DONE** (see Phase 2 Resolution below)

See [v4d-implementation.md](./v4d-implementation.md).

---

## v4d Phase 2 Resolution

Date: 2026-06-24  
Status: **FULLY CLOSED**

- Gap 3 (reschedule both-blank): **FIXED** — UI guard in `trip-reschedule-dialog.tsx`; inline error `"Bitte mindestens ein Datum angeben."`
- CHECK constraint: **APPLIED** — migration `20260624140000_trips_schedule_anchor_check.sql`; pre-apply anchorless count = 0
- v4d complete.

See [v4d-implementation.md](./v4d-implementation.md).

