# Widget Persistence Audit — Kira Herbers / Ingrid Schultz (2026-06-23)

Read-only audit. No code or data changes.

**Question:** After v1/v2 cache invalidation fixes, why do Kira Herbers and Ingrid Schultz still appear in `PendingToursWidget` and/or `TimelessRuleTripsWidget` despite times reportedly being set?

**Short answer:** Root cause **A (database)** for both passengers. The database still contains trip rows with `scheduled_at IS NULL` that correctly match widget predicates. This is not a stale React Query session (B) and not an incorrect filter (C). In both cases, rule-generated paired legs and duplicate outbound instances explain why one leg was scheduled while another row for the same passenger/day remains timeless.

---

## 1. DB state

### Query run

The audit SQL used snake_case column names (actual schema). The `trips` table has no `updated_at` column; `created_at` is used instead.

```sql
SELECT
  id,
  client_name,
  scheduled_at,
  scheduled_at AT TIME ZONE 'Europe/Berlin' AS scheduled_at_berlin,
  requested_date,
  status,
  driver_id,
  fremdfirma_id,
  rule_id,
  linked_trip_id,
  link_type,
  created_at
FROM trips
WHERE
  (client_name ILIKE '%Kira%' OR client_name ILIKE '%Herbers%'
   OR client_name ILIKE '%Ingrid%' OR client_name ILIKE '%Schultz%')
  AND (
    (scheduled_at IS NOT NULL AND DATE(scheduled_at AT TIME ZONE 'Europe/Berlin') = '2026-06-23')
    OR requested_date = '2026-06-23'
    OR scheduled_at IS NULL
  )
ORDER BY created_at DESC
LIMIT 30;
```

Project: TaxiGo Admin Dashboard (`etwluibddvljuhkxjkxs`).

### Relevant rows for 2026-06-23 (Berlin)

#### Kira Herbers — rule `75ad95e1-e37c-45fb-8ded-3f08939fefda`

| id | leg | scheduled_at (UTC) | Berlin local | status | driver | created_at (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| `5185b63f-1a5b-4d07-9c9c-7523d5ccb602` | outbound | `2026-06-23 11:30:00+00` | 13:30 | assigned | set | 2026-06-23 03:04:49 |
| `21a65157-0d1d-41b3-ba4a-eafb504683cb` | return | **NULL** | — | pending | null | 2026-06-09 03:32:01 |
| `54d92673-e96c-42d0-8362-371d117e7238` | outbound (older) | `2026-06-23 09:00:00+00` | 11:00 | assigned | set | 2026-06-09 03:32:01 |

Link graph for 2026-06-23:

- `5185b63f` (new outbound, scheduled) → `linked_trip_id` = `21a65157`
- `21a65157` (return, **unscheduled**) → `linked_trip_id` = `54d92673` (older outbound)
- `54d92673` (older outbound, scheduled) → `linked_trip_id` = `21a65157`

**a. Is `scheduled_at` NULL or populated?** Both outbounds are populated; the **return leg is NULL**.

**b. Exact values when populated:** Outbound `5185b63f` → 13:30 Berlin; outbound `54d92673` → 11:00 Berlin.

**c. Last change proxy:** No `updated_at`. Newest row is outbound `5185b63f` (`created_at` 2026-06-23 03:04:49 UTC). Return leg unchanged since 2026-06-09.

#### Ingrid Schultz — rule `0e23c4eb-eca8-46ef-b13e-fafab20dfde4`

| id | leg | scheduled_at (UTC) | Berlin local | status | driver | created_at (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| `9ae9b84c-154c-44a3-972b-d29fe892d3c4` | outbound | **NULL** | — | pending | null | **2026-06-23 03:05:11** |
| `b7fba5af-0b3e-441d-97d6-de09917c496f` | return | `2026-06-23 13:30:00+00` | 15:30 | assigned | set | 2026-06-22 03:58:52 |

Link graph:

- `9ae9b84c` (new outbound, **unscheduled**) → `linked_trip_id` = `b7fba5af`
- `b7fba5af` (return, scheduled) → `linked_trip_id` = **NULL**

**a. Is `scheduled_at` NULL or populated?** Return is populated; **new outbound is NULL**.

**b. Exact value when populated:** Return `b7fba5af` → 15:30 Berlin.

**c. Last change proxy:** Outbound `9ae9b84c` was **created today** at 03:05:11 UTC (after return was already scheduled on 2026-06-22).

### Rows that match widget predicates today (2026-06-23 Berlin)

**Timeless widget** (`rule_id NOT NULL`, `scheduled_at IS NULL`, `requested_date IN (today, tomorrow)`):

| client | id | requested_date | link_type |
| --- | --- | --- | --- |
| Ingrid Schultz | `9ae9b84c` | 2026-06-23 | outbound |
| Kira Herbers | `21a65157` | 2026-06-23 | return |

**Unplanned widget** (Supabase: `scheduled_at IS NULL OR (driver_id IS NULL AND fremdfirma_id IS NULL)`, not cancelled/completed):

| client | id | scheduled_at | driver | requested_date |
| --- | --- | --- | --- | --- |
| Ingrid Schultz | `9ae9b84c` | NULL | null | 2026-06-23 |
| Kira Herbers | `21a65157` | NULL | null | 2026-06-23 |

Neither passenger’s **scheduled** legs (`5185b63f`, `54d92673`, `b7fba5af`) match the timeless predicate. The rows still in widgets are different trip IDs with `scheduled_at IS NULL`.

---

## 2. Widget filter predicates

### PendingToursWidget — `fetchUnplannedTrips` in `use-unplanned-trips.ts`

**Supabase query (verbatim):**

```ts
.from('trips')
.select(`*, requested_date, ${ASSIGNEE_JOIN_FRAGMENT}`)
.or('scheduled_at.is.null,and(driver_id.is.null,fremdfirma_id.is.null)')
.not('status', 'in', '("cancelled","completed")')
.order('created_at', { ascending: false });
```

**Client-side tab filter** (`today` / `week` / `all`) after fetch:

```ts
const dateStr =
  trip.scheduled_at ??
  trip.linked_trip?.scheduled_at ??
  (trip.requested_date ? `${trip.requested_date}T12:00:00` : null);
// today: isToday(date) — browser-local calendar day, not Berlin TZ
```

**Answers:**

| Question | Answer |
| --- | --- |
| a. Can a trip with non-null `scheduled_at` still pass? | **Yes**, if `driver_id` and `fremdfirma_id` are both null — the `.or()` second branch allows “has time but no assignee”. |
| b. Date range too broad? | Supabase fetch has **no date filter**; all unplanned rows load, then `today`/`week` filter client-side using `scheduled_at`, linked partner time, or `requested_date` noon anchor. |
| c. Status filter? | Excludes `cancelled` and `completed` only. `pending`, `assigned`, etc. can appear if they match the `.or()` clause. |

For Kira/Ingrid on 2026-06-23: the visible rows have **`scheduled_at IS NULL`**, so they pass the first branch regardless of status.

### TimelessRuleTripsWidget — `fetchTimelessRulePairs` in `use-timeless-rule-trips.ts`

**Supabase query (verbatim):**

```ts
.from('trips')
.select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
.not('rule_id', 'is', null)
.is('scheduled_at', null)
.in('requested_date', [todayYmd, tomorrowYmd])  // Berlin YMD from todayYmdInBusinessTz()
.not('status', 'in', '("cancelled","completed")');
```

Pairing is done in JS by `rule_id|requested_date|client_id`, preferring outbound-ish legs first.

**UI guard** in `timeless-rule-trips-widget.tsx`:

```ts
function isTimeless(trip: Trip | null): trip is Trip {
  return !!trip && trip.scheduled_at === null;
}
```

**Answers:**

| Question | Answer |
| --- | --- |
| a. Can a trip with non-null `scheduled_at` pass? | **No** — `.is('scheduled_at', null)` is mandatory at DB level. |
| b. Date range too broad? | Only **Berlin today + tomorrow** `requested_date`. Ingrid/Kira timeless rows for 2026-06-23 are in-window. |
| c. Status filter? | Same as unplanned — not cancelled/completed. `pending` timeless rule legs qualify. |

**Conclusion for section 2:** Filters behave as designed. Rows with NULL `scheduled_at` belong in both widgets. Rows where time was saved (`5185b63f`, `b7fba5af`) are correctly excluded from the timeless query.

---

## 3. `buildScheduledAtOrNull` — can it return null for valid input?

From `trip-time.ts`:

```ts
export function buildScheduledAtOrNull(ymd, hm, timeZone?) {
  if (ymd === null || ymd === undefined || ymd.trim() === '') return null;
  if (hm === null || hm === undefined || hm.trim() === '') return null;
  return buildScheduledAt(ymd, hm, timeZone); // throws TripTimeError on bad input
}
```

**Returns `null` only when:**

- `ymd` is null, undefined, or empty/whitespace
- `hm` is null, undefined, or empty/whitespace

**Does not return null for valid HH:mm** — invalid formats throw `TripTimeError` instead.

Widget callers handle null explicitly:

- **Pending tours:** `if (!iso) { toast.error('Bitte Datum und Uhrzeit vollständig angeben.'); return; }`
- **Timeless:** `if (!iso) { toast.error('Ungültige Uhrzeit.'); continue; }`

**Edge cases:**

| Condition | Result | Widget behavior |
| --- | --- | --- |
| Empty time input | null | Error toast; no `updateTrip` |
| Empty/missing date (`dateStr` / `pair.requested_date`) | null | Error toast; no save |
| Invalid HM / bad YMD | `TripTimeError` | Error toast; no save |
| Valid ymd + hm | ISO string | Save proceeds |

**Conclusion:** A valid time entry does not silently become null. Failed builds surface toasts and skip persistence.

---

## 4. Silent abort paths in widget saves

### `pending-tours-widget.tsx` — `handleSetTime`

| Path | Toast? | Skips `updateTrip`? |
| --- | --- | --- |
| `!time` | `toast.error` (Abholzeit) | Yes |
| `buildScheduledAtOrNull` → null | `toast.error` (vollständig angeben) | Yes |
| `TripTimeError` | `toast.error` (message) | Yes |
| Other error in try | `toast.error` (Fehler) | Yes |

**No silent early-return** that skips save without user feedback.

### `timeless-rule-trips-widget.tsx` — `handleSave`

| Path | Toast? | Skips `updateTrip`? |
| --- | --- | --- |
| `edits.length === 0` | `toast.error` (mindestens eine Abholzeit) | Yes |
| `buildScheduledAtOrNull` → null | `toast.error` (Ungültige Uhrzeit) | `continue` (other legs may still save) |
| `TripTimeError` | `toast.error` | `continue` |
| Catch block | `toast.error` | — |

**Minor UX issue (not silent):** `toast.success('Zeit … gesetzt')` runs even when `savedLegs.length === 0` (all legs hit `continue`). User would see error toasts **and** a success toast — confusing, but not a silent failure.

**Partial-leg save:** Saving only outbound OR return time in a pair is intentional — one leg gets `scheduled_at`, the other remains null and stays in the timeless widget until separately saved.

---

## 5. Rule-based trips

Both passengers have **`rule_id` set** on all audited 2026-06-23 legs.

| Passenger | rule_id | Pattern |
| --- | --- | --- |
| Kira Herbers | `75ad95e1-e37c-45fb-8ded-3f08939fefda` | Paired Hin/Rück; cron generated **second outbound** `5185b63f` on 2026-06-23 while older outbound `54d92673` and unscheduled return `21a65157` remain |
| Ingrid Schultz | `0e23c4eb-eca8-46ef-b13e-fafab20dfde4` | Cron generated **new outbound** `9ae9b84c` on 2026-06-23 03:05 UTC while return `b7fba5af` was already scheduled |

**Can a new generated instance appear alongside a scheduled one?** **Yes.** Evidence:

- Ingrid: return scheduled 2026-06-22; new outbound row created 2026-06-23 with `scheduled_at NULL`.
- Kira: two outbound rows same calendar day (one from 2026-06-09, one from 2026-06-23 cron), return still null.

The timeless widget keys pairs by `rule_id|requested_date|client_id`. A **new unscheduled outbound** with the same key will surface the passenger even when the linked return already has a time (UI shows return time as read-only, outbound still editable).

---

## 6. Senior diagnosis

| Passenger | Root cause | Why |
| --- | --- | --- |
| **Kira Herbers** | **A — Database (write incomplete + duplicate rule legs)** | Return leg `21a65157` still has `scheduled_at IS NULL` in DB. Outbounds `5185b63f` and `54d92673` are scheduled, but the return was never updated. Widgets correctly list the unscheduled return. Saving time on an outbound does not automatically schedule the return. A newer rule-generated outbound (`5185b63f`) coexists with the older scheduled outbound (`54d92673`), both pointing at the same return — link graph is inconsistent (`5185b63f` → `21a65157` → `54d92673`). |
| **Ingrid Schultz** | **A — Database (new rule instance + partial leg schedule)** | Return `b7fba5af` **is** scheduled (15:30 Berlin). A **new** outbound `9ae9b84c` was inserted 2026-06-23 03:05 UTC with `scheduled_at NULL`, likely recurring-rule materialization. Widgets correctly show the new timeless outbound. User may perceive “time was set” because the return has a time, but the outbound row the widget displays is a different trip id. |

### Ruled out

| Cause | Ruled out because |
| --- | --- |
| **B — Cache only** | Fresh DB query shows NULL `scheduled_at` on widget-matching rows. Refetch would still return these rows. v2 invalidation is not the primary issue. |
| **C — Filter predicate bug** | Timeless requires `scheduled_at IS NULL`; scheduled legs are excluded. Unplanned requires null time OR missing assignee; current rows legitimately qualify. |

### If the team expected rows to disappear after “setting time”

1. **Confirm which trip id was saved** — paired rule trips have separate outbound/return rows; scheduling one leg leaves the other in widgets.
2. **Check for post-save cron/rule regeneration** — new rows with `created_at` on 2026-06-23 03:04–03:05 UTC appeared after earlier instances; these re-open the widget until individually scheduled.
3. **Kira return `21a65157`** — needs its own `scheduled_at` write (widget timeless save, detail sheet, or paired sync) to leave timeless/unplanned lists.
4. **Ingrid outbound `9ae9b84c`** — needs time assigned; scheduling return `b7fba5af` alone is insufficient for the pair row driven by the unscheduled outbound.

### Recommended follow-up (out of audit scope)

- Investigate recurring-rule cron / generation dedup: why new outbound rows are created when a linked return or sibling outbound for the same `rule_id|requested_date|client_id` already exists.
- Repair bidirectional link consistency for Kira (`5185b63f` ↔ `21a65157` ↔ `54d92673`).
- Consider product UX: after scheduling one leg of a rule pair, prompt to schedule the partner leg or auto-sync times for rule-generated pairs.

---

## Appendix — Files reviewed

1. `src/features/dashboard/hooks/use-unplanned-trips.ts`
2. `src/features/dashboard/hooks/use-timeless-rule-trips.ts`
3. `src/features/trips/lib/trip-time.ts`
4. `src/features/trips/lib/trip-business-date.ts`
5. `src/features/dashboard/components/pending-tours-widget.tsx`
6. `src/features/dashboard/components/timeless-rule-trips-widget.tsx`
