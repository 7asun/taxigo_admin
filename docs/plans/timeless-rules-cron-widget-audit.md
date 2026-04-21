# Timeless rules — cron lookahead vs dashboard widget (read-only audit)

Scope: **read-only** analysis of the cron trip generator and the dashboard “Offene Touren” widget behavior, focusing on (a) lookahead window and deduplication and (b) feasibility of row-grouping (Hinfahrt + Rückfahrt in one row).

Date: 2026-04-16

---

## Step 1 — Files read (in full)

### Cron entrypoint

- `src/app/api/cron/generate-recurring-trips/route.ts`

### Non-`node_modules` imports of the cron route (explicit list)

Direct imports from `src/app/api/cron/generate-recurring-trips/route.ts`:

- `src/types/database.types.ts` (imported as `type Database`)
- `src/lib/google-geocoding.ts` (imports: none)
- `src/lib/google-directions.ts`
  - imports `src/types/database.types.ts`
- `src/features/trips/lib/recurring-return-mode.ts` (imports: none)

### Trip linking / widget inputs

- `src/features/trips/api/trips.service.ts`
- `src/features/dashboard/hooks/use-unplanned-trips.ts`
- `src/features/dashboard/components/pending-tours-widget.tsx`

---

## Step 2 — Cron lookahead (precise answers)

### 1) Date window (exact range + code)

The cron uses a **fixed, hard-coded 14-day lookahead** from “today (local, start of day)” through “today + 14 days (local, end of day)”.

Code:

```84:86:src/app/api/cron/generate-recurring-trips/route.ts
    const todayLocal = startOfDay(new Date());
    const windowEndLocal = endOfDay(addDays(todayLocal, 14));
```

This is **not** controlled by an env var and is **not** computed from rule fields. It’s an inline constant `14`.

The effective search window per rule is then intersected with rule start/end dates:

```353:385:src/app/api/cron/generate-recurring-trips/route.ts
      const ruleStartDateLocal = startOfDay(new Date(rule.start_date));
      const ruleEndDateLocal = rule.end_date
        ? endOfDay(new Date(rule.end_date))
        : windowEndLocal;
      // ...
      const searchStartLocal = isAfter(todayLocal, ruleStartDateLocal)
        ? todayLocal
        : ruleStartDateLocal;
      const searchEndLocal = isBefore(windowEndLocal, ruleEndDateLocal)
        ? windowEndLocal
        : ruleEndDateLocal;
```

### 2) Timeless-trip interaction with the lookahead window (math, no assumptions beyond code)

#### What “timeless” means in the current cron

In this cron, `scheduled_at` is only `null` for **return legs** when `returnMode !== 'exact'` (i.e. `returnMode === 'time_tbd'`), because it sets `returnScheduledIso` to `null` in that case:

```462:474:src/app/api/cron/generate-recurring-trips/route.ts
        const returnScheduledIso =
          returnMode === 'exact'
            ? toScheduledIso( /* ... */ )
            : null;
```

Outbound legs are always created with a computed ISO timestamp (never `null`) because the cron always computes `outboundScheduledIso` from `rule.pickup_time`:

```417:439:src/app/api/cron/generate-recurring-trips/route.ts
        const outboundScheduledIso = toScheduledIso(
          dateStr,
          // exception override OR rule.pickup_time
          /* ... */ rule.pickup_time
        );
        const outboundPayload = await buildTripPayload({
          // ...
          scheduledAtIso: outboundScheduledIso,
```

Also, `buildTripPayload` explicitly refuses to build an **outbound** trip if the pickup time is missing:

```169:175:src/app/api/cron/generate-recurring-trips/route.ts
      if (!isReturnTrip) {
        const pt = exception?.modified_pickup_time || rule.pickup_time;
        if (!pt) return null;
      } else if (returnMode === 'exact') {
        const pt = exception?.modified_pickup_time || rule.return_time;
        if (!pt) return null;
      }
```

So a hypothetical `pickup_time_mode = 'daily_agreement'` that implies “no outbound time” is **not represented** in this cron (there is no `pickup_time_mode` read, and outbound requires a time).

#### “How many timeless trips per rule per cron run” (given the above)

For rules with `returnMode === 'time_tbd'` (Zeitabsprache return):

- **Timeless legs per occurrence day**: **1** (the return leg only).
- **Occurrences within the cron window**: call this **N** (number of recurrence dates between `searchStart...searchEnd`, inclusive).
- **Timeless trips inserted per rule per cron run (first run, before dedup hits)**: \(1 \times N = N\).

If a rule also had a timeless outbound (not supported by current code), it would be \(2 \times N\). **That case is hypothetical and not implemented in the cron.**

#### Widget rows “immediately” after a cron run (counts and filter caveat)

The widget’s “ohne Zeit” count is based on `!t.scheduled_at`:

```95:101:src/features/dashboard/components/pending-tours-widget.tsx
            const noTime = trips.filter((t) => !t.scheduled_at).length;
```

`useUnplannedTrips` includes all trips where `scheduled_at` is null **OR** `driver_id` is null:

```48:53:src/features/dashboard/hooks/use-unplanned-trips.ts
    .or('scheduled_at.is.null,driver_id.is.null')
```

So, for a single passenger with one timeless-return rule:

- **In the database** (and therefore in the “All” tab): rows added by one cron run = \(N\) timeless rows.
  - If **N = 14**, that’s \(14\) timeless rows.
  - If **N = 1**, that’s \(1\) timeless row.

Important caveat: the widget defaults to the **`today`** tab, and filtering uses a derived “date” from `scheduled_at` or `linked_trip.scheduled_at` or `requested_date`:

```102:111:src/features/dashboard/hooks/use-unplanned-trips.ts
          const dateStr =
            trip.scheduled_at ??
            trip.linked_trip?.scheduled_at ??
            (trip.requested_date ? `${trip.requested_date}T12:00:00` : null);
```

For timeless **return** legs, `scheduled_at` is null but `linked_trip?.scheduled_at` is typically the outbound’s fixed time (because return legs link to the outbound). That means:

- In **Heute**: you would see only the timeless rows whose linked outbound falls on “today”.
- In **All**: you’d see all \(N\) timeless rows produced by the lookahead.

### 3) Deduplication scope (exact query)

Deduplication is done by `findExistingRecurringLegId`, which queries `trips` by:

- `client_id`
- `rule_id`
- `requested_date`
- and then:
  - `scheduled_at IS NULL` if the candidate leg has `scheduled_at === null`
  - else `scheduled_at = <iso>`
- plus a leg discriminator:
  - outbound: `link_type IS NULL OR link_type = 'outbound'`
  - return: `link_type = 'return'`

Exact code:

```272:301:src/app/api/cron/generate-recurring-trips/route.ts
    async function findExistingRecurringLegId(q: {
      client_id: string;
      rule_id: string;
      scheduled_at: string | null;
      requested_date: string;
      leg: 'outbound' | 'return';
    }): Promise<string | null> {
      let query = supabase
        .from('trips')
        .select('id')
        .eq('client_id', q.client_id)
        .eq('rule_id', q.rule_id)
        .eq('requested_date', q.requested_date);

      if (q.scheduled_at === null) {
        query = query.is('scheduled_at', null);
      } else {
        query = query.eq('scheduled_at', q.scheduled_at);
      }

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

Therefore:

- Yes, it prevents re-inserting the same **rule + requested_date** combination on subsequent runs **as long as** the other key fields match:
  - For outbound: `scheduled_at` must match exactly (the computed ISO) and link_type must be null/outbound.
  - For a timeless return: `scheduled_at` is `NULL` and `link_type = 'return'`, so it dedups on `(client_id, rule_id, requested_date, scheduled_at IS NULL, link_type='return')`.

Notably, timeless returns are **not** deduped solely “on scheduled_at” (since it’s null); they are deduped on **requested_date + rule_id + client_id + scheduled_at is null + link_type='return'**.

### 4) Fixed-time vs timeless split (different windows?)

No. There is **no mechanism** in this cron to generate different date windows for different rule types.

- The only lookahead is the single `addDays(..., 14)` window (then intersected with rule start/end), and it is applied to **all rules** equally.
- The code does not branch on any “time mode” field for the window.

---

## Step 3 — Widget row grouping feasibility

### 5) Current linking model (DB fields written by cron)

#### Return leg payload (built with `isReturnTrip: true`)

The return leg is inserted with:

- `rule_id: rule.id`
- `requested_date: dateStr`
- `scheduled_at: null` when `returnMode !== 'exact'` (Zeitabsprache)
- `link_type: 'return'`
- `linked_trip_id: outboundId` (points to the outbound trip)

The relevant payload fields are set in `buildTripPayload`:

```214:269:src/app/api/cron/generate-recurring-trips/route.ts
      const link_type = isReturnTrip ? 'return' : outboundLinkType;
      // ...
      return {
        // ...
        requested_date: dateStr,
        // ...
        scheduled_at: scheduledAtIso,
        rule_id: rule.id,
        link_type,
        linked_trip_id: linkedTripId
      };
```

And the return leg call site passes `linkedTripId: outboundId`:

```475:486:src/app/api/cron/generate-recurring-trips/route.ts
        const returnPayload = await buildTripPayload({
          // ...
          isReturnTrip: true,
          // ...
          scheduledAtIso: returnScheduledIso,
          linkedTripId: outboundId,
          outboundLinkType: null
        });
```

#### Outbound leg payload + post-insert update (mutual linking)

The outbound leg is initially inserted with:

- `rule_id: rule.id`
- `requested_date: dateStr`
- `scheduled_at: outboundScheduledIso` (non-null)
- `link_type: null` (initially)
- `linked_trip_id: null` (initially)

Same payload block as above; call site passes null link fields:

```428:439:src/app/api/cron/generate-recurring-trips/route.ts
        const outboundPayload = await buildTripPayload({
          // ...
          isReturnTrip: false,
          // ...
          scheduledAtIso: outboundScheduledIso,
          linkedTripId: null,
          outboundLinkType: null
        });
```

After the return leg is successfully inserted, the cron **updates the outbound row** to point back to the return row and sets `link_type = 'outbound'`:

```500:506:src/app/api/cron/generate-recurring-trips/route.ts
        const { error: linkOutError } = await supabase
          .from('trips')
          .update({
            linked_trip_id: returnId,
            link_type: 'outbound'
          })
          .eq('id', outboundId);
```

**Answer to the explicit questions:**

- **Is `linked_trip_id` set on both legs?** Yes (after the outbound update). Return points to outbound at insert-time; outbound points to return via a subsequent update.
- **Is `link_type` set? Values?** Yes. Return leg: `'return'` (at insert-time). Outbound leg: `'outbound'` (set by update); initially `null` at insert-time.
- **Is `rule_id` set on both legs?** Yes (`rule_id: rule.id` is always set by `buildTripPayload` for both legs).

### 6) Current widget grouping (does it group/sort?) and how pairs appear

`useUnplannedTrips` returns a **flat list**:

- Query orders by `created_at DESC`:

```48:54:src/features/dashboard/hooks/use-unplanned-trips.ts
    .order('created_at', { ascending: false });
```

- It then sorts **only** by `scheduled_at` (ascending). Trips with `scheduled_at = null` are pushed after timed trips, and the relative order among null-timed trips is not stabilized (comparator returns `0` when both are null):

```113:120:src/features/dashboard/hooks/use-unplanned-trips.ts
  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : null;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
    if (aTime !== null && bTime !== null) return aTime - bTime;
    if (aTime !== null) return -1;
    if (bTime !== null) return 1;
    return 0;
  });
```

There is **no grouping** or sorting by:

- `linked_trip_id`
- `rule_id`
- `client_id`

The widget renders `trips.map(...)` to show one row per trip:

```128:136:src/features/dashboard/components/pending-tours-widget.tsx
              <div className='space-y-3'>
                {trips.map((trip) => (
                  <UnplannedTripRow
                    key={trip.id}
                    trip={trip}
                    drivers={drivers}
                  />
                ))}
              </div>
```

So if both legs of a linked pair are “unplanned”, they appear as **two separate rows** today.

### 7) Grouping feasibility for “one row per passenger per day” (outbound+return side-by-side)

Target shape: `{ outbound: UnplannedTrip, return: UnplannedTrip | null }` per passenger per day.

#### (a) Is the data already available client-side for grouping?

**Partially yes**, but with caveats:

- The `trips` rows returned by `fetchUnplannedTrips` include `linked_trip_id`, `link_type`, `requested_date`, `rule_id`, etc. (it selects `*`).
- However, the hook only enriches a **minimal** `linked_trip` object with `scheduled_at/status/link_type`, via a **second query** based on `linked_trip_id`:

```61:96:src/features/dashboard/hooks/use-unplanned-trips.ts
  const linkedIds = Array.from(
    new Set(
      rows.map((t) => t.linked_trip_id).filter((id): id is string => !!id)
    )
  );
  // ...
  const { data: linkedRows } = await supabase
    .from('trips')
    .select('id, scheduled_at, status, link_type')
    .in('id', linkedIds);
```

Because `fetchUnplannedTrips` already includes **both** legs as separate rows (if both meet the “unplanned” predicate), you can group **purely client-side** by:

- `linked_trip_id` + `link_type` (mutual linking model), or
- `rule_id + requested_date + client_id` (cron guarantees those per leg; but other sources may not).

No server join is strictly required **as long as both legs are in the unplanned list**.

But: if only one leg is unplanned (e.g. outbound gets planned, return is still timeless/unplanned), you’d only have one row in the list. The partner exists in DB but might not be returned. In that case, grouping into a pair would either:

- return `{ outbound: null, return: trip }` (needs UI decision), or
- require a different query shape if you want to always fetch both legs.

#### (b) Trips with `return_mode = none`

Cron does not create a return leg when returnMode is `'none'`:

```453:456:src/app/api/cron/generate-recurring-trips/route.ts
        if (returnMode === 'none') continue;
```

So they naturally show as a **single row** today. In a paired layout, these should be emitted as `{ outbound, return: null }`. This is consistent with current data.

#### (c) Existing unplanned trips with `rule_id = null` (predate rule_id or non-recurring sources)

The hook explicitly includes unplanned trips regardless of `rule_id`:

```48:53:src/features/dashboard/hooks/use-unplanned-trips.ts
    .from('trips')
    .select('*, requested_date')
    .or('scheduled_at.is.null,driver_id.is.null')
```

So `rule_id = null` is expected. Those trips **cannot** be grouped by rule semantics.

The widget already handles non-rule trips by:

- using `requested_date` as a badge for non-return trips:

```252:260:src/features/dashboard/components/pending-tours-widget.tsx
          {trip.requested_date && !isReturnTrip && (
            <Badge variant='outline' className='gap-1 px-1.5 py-0 text-xs'>
              <Calendar className='h-3 w-3' />
              Termin:{' '}
              {format(new Date(trip.requested_date), 'dd.MM.', {
                locale: de
              })}
            </Badge>
          )}
```

Recommendation (based on current behavior): keep them as **single, ungrouped rows**, because grouping by rule/day would not apply.

### 8) Mixed widget content (rule vs non-rule)

The widget shows **all** unplanned trips; it does not filter to recurring-generated ones.

Evidence: the unplanned query only checks `scheduled_at` and `driver_id` and excludes cancelled/completed. It does not require `rule_id`:

```48:53:src/features/dashboard/hooks/use-unplanned-trips.ts
    .or('scheduled_at.is.null,driver_id.is.null')
    .not('status', 'in', '("cancelled","completed")')
```

Therefore, non-rule trips (`rule_id = null`) are a first-class part of the list.

#### Should non-rule trips be grouped?

Based on current data shape and behavior, the safest option is:

- **Fall through to ungrouped single rows (same as today).**

#### What fraction are rule vs non-rule?

From the audited files alone, there is **no reliable signal** to quantify the fraction (no filter, no telemetry, no explicit ingestion-source breakdown in these modules).

The code indicates multiple sources exist (e.g. CSV imports are referenced via `requested_date` usage and comments), but it does **not** provide counts or proportions. Any estimate would be an assumption, so I’m not stating a percentage.

---

## Step 4 — Senior recommendation stub (based only on findings above)

### A) Cron window recommendation (minimum viable timeless lookahead)

Observed problem mechanism:

- Cron lookahead is **14 days** for all rules.
- For `returnMode === 'time_tbd'`, each occurrence produces a **timeless return** (`scheduled_at = null`).
- The widget includes **all** `scheduled_at IS NULL` trips as “ohne Zeit”, and the “All” tab will show all \(N\) of them.

Given deduplication is stable on `requested_date + rule_id + client_id + scheduled_at IS NULL + link_type='return'`, reducing the window will **not** create duplicates; it will simply reduce how many future “timeless” rows exist at once.

Minimum viable lookahead for timeless returns, purely to reduce widget noise:

- **Recommendation**: generate timeless trips for **1 day ahead** (effectively “tomorrow only”) rather than 14.
- Reasoning from code:
  - `useUnplannedTrips` filters “today/week/all” by `scheduled_at ?? linked_trip.scheduled_at ?? requested_date`. For timeless returns, the date used is typically the linked outbound date.
  - A 14-day window mostly impacts the **All** tab (and any future “week” views once the week window includes more days).
  - With N=1, per passenger/rule the immediate timeless-row count is \(1\), not \(14\).

Note: This cron currently has only one window; implementing a different window for timeless would require code changes (out of scope here).

### B) Grouping complexity (client transform vs new query/hook)

Based on the mutual linking model (`linked_trip_id` on both legs + `link_type`), a **client-side transform** is feasible for the common case where both legs appear in the unplanned list:

- Group by `linked_trip_id` + `link_type` pairs (since outbound points to return and return points to outbound), or
- Group by `(client_id, rule_id, requested_date)` for cron-generated rows.

Complexity estimate from existing code:

- **Moderate**: you can implement a deterministic pairing in the hook without new server endpoints, but you must handle edge cases:
  - only one leg unplanned (partner not returned by the query)
  - non-rule trips (`rule_id = null`)
  - legacy trips with `link_type` null (the code explicitly mentions “legacy rows without link_type” in the widget)

If the UX requires “always show both legs if either is unplanned”, then a **new query shape** (server-side join or two-phase fetch that loads the missing partner trip rows) would be required.

### C) Ungrouped trips fallback (rule_id = null)

Falling back to single-row display for non-rule trips (`rule_id = null`) is **safe and consistent** with current behavior, because:

- The current UI already renders a row per trip and does not assume pairing.
- The unplanned list intentionally mixes multiple sources and does not guarantee `rule_id`.

