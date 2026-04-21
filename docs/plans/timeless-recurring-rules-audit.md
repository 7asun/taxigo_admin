# Timeless recurring rules — read-only audit

**Phase 1: COMPLETE — 2026-04-17**

**Phase 2: COMPLETE — 2026-04-17**

Audit scope per request: **read-only**. All findings below are derived from the files listed in the prompt (plus the located cron entrypoint `src/app/api/cron/generate-recurring-trips/route.ts` and its direct helper imports, plus `vercel.json` for the cron schedule, as referenced by the prompt’s “trigger frequency” question).

## Files read

- `src/features/trips/api/recurring-rules.service.ts`
- `src/features/trips/api/recurring-rules.server.ts`
- `src/features/clients/lib/build-recurring-rule-payload.ts`
- `src/features/clients/components/recurring-rule-form-body.tsx`
- `src/app/api/cron/generate-recurring-trips/route.ts`
- Helpers imported by the cron:
  - `src/lib/google-geocoding.ts`
  - `src/lib/google-directions.ts`
  - `src/features/trips/lib/recurring-return-mode.ts`
- `src/features/trips/api/trips.service.ts`
- `src/features/dashboard/hooks/use-unplanned-trips.ts`
- `src/features/dashboard/components/pending-tours-widget.tsx`
- `src/features/trips/lib/trip-status.ts`
- `src/types/database.types.ts`
- Docs/plans search results (for Q11/Q12):
  - `vercel.json`
  - `docs/access-control.md`
  - `docs/billing-families-variants.md`
  - `docs/trip-linking-and-cancellation.md`
  - `docs/trip-reschedule-v1.md`
  - `docs/address-autocomplete.md`
  - `docs/driving-metrics-api.md`
  - `docs/fremdfirma.md`
  - `docs/bulk-trip-upload.md`
  - `docs/bulk-upload-behavior-rules.md`
  - `docs/dispatch-inbox.md`
  - `docs/date-picker.md`
  - `docs/trips-duplicate.md`
  - `.cursor/plans/refine-client-recurring-trip-behavior_71404970.plan.md`
  - `.cursor/plans/kts_document_workflow.plan.md`
  - `.cursor/plans/refactor-create-trip-form_43eb52ea.plan.md`
  - `.cursor/plans/billing_families_variants_98fd187b.plan.md`
  - `.cursor/plans/neue_regelfahrt_sheet_41fe31fd.plan.md`

---

## STEP 2 — Answers

### 1) `pickup_time` field (ruleFormSchema validation, DB nullability, payload transform)

#### 1a. Current validation in `ruleFormSchema`

From `src/features/clients/components/recurring-rule-form-body.tsx`:

- Field: `pickup_time`
- Zod: `z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Bitte ein gültiges Zeitformat verwenden (HH:MM)')`
- **Required**: yes (it is a `string()` with a regex; there is no `.optional()`/`.nullable()` and no `.min(1)` but the regex will reject empty strings).

Default value behavior in `getRuleFormDefaults()`:

- When `initialData` is absent: `pickup_time: '08:00'`
- When `initialData` is present: `pickup_time: initialData.pickup_time.substring(0, 5)` (assumes DB stores a string with at least `HH:MM...`).

#### 1b. DB column nullable?

From `src/types/database.types.ts`:

- `Database['public']['Tables']['recurring_rules']['Row']['pickup_time']` is `string` (not nullable).

#### 1c. `buildRecurringRulePayload` handling of `pickup_time`

From `src/features/clients/lib/build-recurring-rule-payload.ts`:

- It **transforms** the form’s `HH:MM` into an `HH:MM:00` string:
  - `pickup_time: \`${values.pickup_time}:00\`,`
- It writes the transformed string directly to the insert payload (`InsertRecurringRule` shape). There is no additional parsing beyond string concatenation.

---

### 2) DB column nullability (types in `database.types.ts`)

From `src/types/database.types.ts`:

#### 2a. `trips.scheduled_at`

- `Database['public']['Tables']['trips']['Row']['scheduled_at']`: `string | null`

#### 2b. `trips.pickup_time` (separate column?)

- **Not found** as a top-level field on `trips.Row`.
- `trips.Row` has `scheduled_at` and `requested_date` (both nullable), but **no** `pickup_time` column.

#### 2c. `recurring_rules.pickup_time`

- `Database['public']['Tables']['recurring_rules']['Row']['pickup_time']`: `string` (not nullable)

---

## CRON / TRIP GENERATOR

### 3) Generator behaviour (`src/app/api/cron/generate-recurring-trips/route.ts`)

#### 3a. What does it do with `pickup_time` when creating a trip? Does it compute `scheduled_at`?

Yes. For the outbound leg it computes an ISO string using the rule time (or exception override):

- `outboundExceptionKey = clockToHhMmSs(rule.pickup_time);`
- `outboundScheduledIso = toScheduledIso(dateStr, exceptions?...?.modified_pickup_time || rule.pickup_time);`

Where:

- `toScheduledIso(dateStr, timeHhMmSs)` returns:
  - `new Date(\`${dateStr}T${clockToHhMmSs(timeHhMmSs)}\`).toISOString();`

And the trip insert payload writes:

- `scheduled_at: scheduledAtIso,` (from `buildTripPayload` return object)

For return legs:

- If `returnMode === 'exact'`: `returnScheduledIso = toScheduledIso(dateStr, exceptionOverrideOrRuleReturnTime)`
- If `returnMode !== 'exact'` (i.e. `time_tbd`): `returnScheduledIso = null`

#### 3b. If `pickup_time` is null or empty, does the generator skip/throw/create `scheduled_at = null`?

Based on the file content:

- The generator does **not** have an “outbound no time” mode.
- It calls `clockToHhMmSs(rule.pickup_time)` and `toScheduledIso(..., rule.pickup_time)` **before** the `buildTripPayload` “presence check” runs.
- `buildTripPayload` contains a check:
  - Outbound: `const pt = exception?.modified_pickup_time || rule.pickup_time; if (!pt) return null;`
  - But this check happens **after** `outboundScheduledIso` is already computed.

So, for outbound:

- **Null pickup_time**: not representable at the type level for `RecurringRuleRow` (`pickup_time: string` in `database.types.ts`), but if it were present at runtime, `clockToHhMmSs` calls `clock.trim()` and would throw.
- **Empty string pickup_time**: `clockToHhMmSs('')` returns `''`; `toScheduledIso(dateStr, '')` calls `new Date(\`${dateStr}T\`).toISOString()` which would fail (`Invalid time value`) when `toISOString()` is called.

For return `time_tbd` legs:

- It explicitly sets `returnScheduledIso = null` and inserts the trip with `scheduled_at: null`.

#### 3c. Does the generator already handle a “no time” case in any way?

Yes, but **only** for return legs with `returnMode === 'time_tbd'`:

- `returnScheduledIso = ... : null;`
- It also uses a sentinel for exception targeting:
  - `RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME = '00:00:00'` (from `src/features/trips/lib/recurring-return-mode.ts`)
  - For `time_tbd` return legs: `returnExceptionKey = RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME`

Outbound legs are always generated with a concrete `scheduled_at` computed from `rule.pickup_time` (or exception override).

#### 3d. What trip status does the generator assign to newly created trips?

In `buildTripPayload`, status depends on `rule.fremdfirma_id`:

- If `rule.fremdfirma_id` is truthy:
  - `driver_id: null`
  - `needs_driver_assignment: false`
  - `status: 'assigned' as const`
- Else:
  - `status: 'pending' as const`

#### 3e. Deduplication (skip already-generated trips for same rule + date)?

Yes. It queries for an existing leg before inserting:

- `findExistingRecurringLegId()` selects from `trips` with:
  - `.eq('client_id', q.client_id)`
  - `.eq('rule_id', q.rule_id)`
  - `.eq('requested_date', q.requested_date)`
  - plus:
    - if `q.scheduled_at === null`: `.is('scheduled_at', null)`
    - else `.eq('scheduled_at', q.scheduled_at)`
  - leg discriminator:
    - outbound: `.or('link_type.is.null,link_type.eq.outbound')`
    - return: `.eq('link_type', 'return')`

If an ID is found, insertion is skipped and the existing id is returned.

---

### 4) Generator entry point + trigger frequency

#### 4a. Trigger mechanism

The generator is an **HTTP GET route**:

- `GET /api/cron/generate-recurring-trips` implemented in `src/app/api/cron/generate-recurring-trips/route.ts`.

Security gate (from the route code):

- Requires `CRON_SECRET` to be set (else returns `403`).
- Accepts either:
  - `Authorization: Bearer <CRON_SECRET>` (Vercel Cron format), or
  - header `x-cron-secret: <CRON_SECRET>` (manual/scripted calls).
- Uses **Supabase service role** (`SUPABASE_SERVICE_ROLE_KEY`) via `createClient<Database>(supabaseUrl, serviceRoleKey, ...)`.

#### 4b. Trigger frequency

From `vercel.json`:

- Cron schedule is:
  - `path`: `/api/cron/generate-recurring-trips`
  - `schedule`: `0 3 * * *`

---

## PENDING TOURS WIDGET

### 5) `useUnplannedTrips` query (exact Supabase query, columns, filters)

From `src/features/dashboard/hooks/use-unplanned-trips.ts` (`fetchUnplannedTrips`):

Query:

- Table: `trips`
- Select: `.select('*, requested_date')`
- “Unplanned” filter: `.or('scheduled_at.is.null,driver_id.is.null')`
- Status exclusion: `.not('status', 'in', '("cancelled","completed")')`
- Order: `.order('created_at', { ascending: false })`

Does it include `scheduled_at IS NULL`?

- Yes, explicitly via `.or('scheduled_at.is.null,driver_id.is.null')`.

Additional linked-trip enrichment (second query, conditional):

- If any `linked_trip_id` exists in the result set, it loads:
  - `.from('trips').select('id, scheduled_at, status, link_type').in('id', linkedIds)`
- and attaches `linked_trip` with fields:
  - `scheduled_at: string | null`
  - `status: string | null`
  - `link_type: string | null`

Tab filter logic (today/week/all):

- If filter is `'all'`: no date gate; returns all rows.
- If filter is `'today'` or `'week'`: it derives a date string via:
  - `trip.scheduled_at ?? trip.linked_trip?.scheduled_at ?? (trip.requested_date ? \`${trip.requested_date}T12:00:00\` : null)`
  - If that derived `dateStr` is null → the trip is **excluded** from `today/week` filters.

---

### 6) `UnplannedTrip` shape (fields + nullability)

From `src/features/dashboard/hooks/use-unplanned-trips.ts`:

- `UnplannedTrip` is defined as:
  - `Trip & { requested_date?: string | null; linked_trip?: { scheduled_at: string | null; status: string | null; link_type: string | null } | null }`

Where `Trip` is:

- `Database['public']['Tables']['trips']['Row']` from `src/features/trips/api/trips.service.ts`.

Fields on `Trip` are the full `trips.Row` shape from `src/types/database.types.ts` (including, relevant to this audit):

- `scheduled_at: string | null`
- `requested_date: string | null` (and the hook redundantly re-selects it)
- `driver_id: string | null`
- `status: string` (non-nullable)
- `rule_id: string | null`
- `linked_trip_id: string | null`
- `link_type: string | null`
- (many other columns; see `trips.Row` in `src/types/database.types.ts` for complete list)

Nullable vs always-present in `UnplannedTrip` (as typed):

- Always present (from `Trip`): every non-optional key in `trips.Row` (notably `id: string`, `status: string`).
- Nullable (from `Trip`): many fields, including `scheduled_at`, `requested_date`, `driver_id`, `rule_id`, `linked_trip_id`, `link_type`, etc.
- Optional on the type level:
  - `requested_date?: string | null` (optional property, though it is selected in the query)
  - `linked_trip?: ... | null` (optional property, populated post-query)

---

### 7) Widget behavior (`pending-tours-widget.tsx` + query)

#### 7a. Would a trip generated from a “timeless rule” (`scheduled_at = null`) appear today?

Based on:

- The query includes `.or('scheduled_at.is.null,driver_id.is.null')`, so **any `scheduled_at IS NULL` trip** is included in the raw result set.
- For dashboard filters:
  - In `today` / `week`, the hook will exclude rows where it cannot derive a date from:
    - `scheduled_at`, or
    - `linked_trip.scheduled_at`, or
    - `requested_date` (converted to `T12:00:00`).

Cron-created `time_tbd` return legs set:

- `scheduled_at: null`
- `requested_date: dateStr` (set in the cron payload)

Therefore:

- A cron-created timeless return trip **will appear** in the widget for `today` / `week` / `all`, assuming its `requested_date` falls in the selected range.

If a trip had:

- `scheduled_at = null` and `requested_date = null` and `linked_trip?.scheduled_at = null`,

Then:

- It would **still appear** under `all` (no date gate),
- but would be **excluded** from `today` and `week` (the date gate returns `false` when `dateStr` is null).

#### 7b. “Set time” button disabled when `!time`: any other gate preventing saving a timeless trip?

From `src/features/dashboard/components/pending-tours-widget.tsx`:

- `handleSetTime` starts with:
  - `if (!time) { toast.error(...); return; }`
- The button is disabled when:
  - `disabled={!time || isSubmitting}`

Other runtime gates in this component:

- It always sets a payload with:
  - `scheduled_at` (computed)
  - `driver_id` (current selection; can be null)
  - optional `status` (derived via `getStatusWhenDriverChanges(...)` only if that helper returns a value)
- There is no additional “must have driver” or “must have date” gate; date defaults to `initialDate` and is editable.

#### 7c. Date/time prefill when `scheduled_at = null` and `requested_date = null`

Prefill logic in `UnplannedTripRow`:

- `initialDate`:
  1. If `trip.scheduled_at`: use its date
  2. Else if `trip.requested_date`: use it
  3. Else if `trip.linked_trip?.scheduled_at`: use its date
  4. Else: **today’s date** (`new Date().toISOString().slice(0, 10)`)
- `initialTime`:
  - If `trip.scheduled_at`: `format(..., 'HH:mm')`
  - Else: `''`

So for `scheduled_at = null` and `requested_date = null`:

- Prefilled date: **today**
- Prefilled time: **empty string**

---

## TRIP STATUS

### 8) Status model (values, “generated but not yet scheduled”, driver assignment)

#### 8a. Status values found in the audited sources

From code (direct string literals):

- `src/features/trips/lib/trip-status.ts`:
  - `pending`
  - `assigned`
- `src/features/dashboard/hooks/use-unplanned-trips.ts` excludes:
  - `cancelled`
  - `completed`
- `src/app/api/cron/generate-recurring-trips/route.ts` sets:
  - `pending`
  - `assigned`

From documentation within the repo (non-exhaustive, but present in `docs/trip-status-helper.md`):

- Mentions “other statuses” such as:
  - `in_progress`
  - `completed`
  - `cancelled`

No dedicated status meaning “timeless/pending time” was found in `src/features/trips/lib/trip-status.ts`.

#### 8b. Is there a status distinct for “generated but not yet scheduled”?

In the audited code:

- There is **no dedicated status** for “generated but not yet scheduled”.
- “No time” is represented by `trips.scheduled_at IS NULL` (and optionally `requested_date` carrying the calendar day).

#### 8c. What status does `getStatusWhenDriverChanges` return when going from no driver → driver assigned?

From `src/features/trips/lib/trip-status.ts`:

- When `newDriverId != null && newDriverId !== ''`:
  - If `currentStatus === 'pending'`: returns `'assigned'`
  - Else: returns `undefined`

---

## LINKAGE: RULE → TRIP

### 9) Rule-to-trip traceability

Yes. The cron writes the rule id to the trip:

- In `buildTripPayload` return object:
  - `rule_id: rule.id,`

DB column (from `src/types/database.types.ts`):

- `Database['public']['Tables']['trips']['Row']['rule_id']`: `string | null`

So trips can be traced back to a rule by `trips.rule_id` when populated (cron sets it).

---

## Existing “timeless trip” precedent

### 10) Do any code paths intentionally create `scheduled_at = null` trips?

Yes, multiple precedents exist in the code/docs referenced by this audit:

1. **Recurring cron: return leg with `return_mode = 'time_tbd'`**
   - In `src/app/api/cron/generate-recurring-trips/route.ts`:
     - `returnScheduledIso = ... : null;`
     - Insert payload includes `scheduled_at: null` for that return leg.
     - It still sets `requested_date: dateStr`.

2. **CSV bulk upload behavior (documented)**
   - In `docs/bulk-trip-upload.md`:
     - If CSV `time` is empty: “`scheduled_at = NULL` and `requested_date = date`”, and it appears in “Offene Touren”.
   - In `docs/bulk-upload-behavior-rules.md`:
     - “A trip appears in the Offene Touren widget when `scheduled_at IS NULL`.”
     - Also describes return-policy placeholder returns with `scheduled_at = NULL`.

3. **UI/editing semantics for “Zeitabsprache” (documented)**
   - In `docs/trip-reschedule-v1.md`:
     - Leaving the time field empty results in `scheduled_at = null` and optional `requested_date`.
   - (This doc points at shared date/time picker patterns; this audit did not enumerate the full create-trip form implementation.)

Status for those rows (from audited code/doc evidence):

- Cron-generated rows:
  - Default `status: 'pending'` unless `fremdfirma_id` is set → `'assigned'`.
- CSV-created rows:
  - `docs/bulk-trip-upload.md` states `status = 'pending'` for inserted trips.

---

## DOCS & PLANS

### 11) Relevant docs (mentions of pickup_time / timeless / ohne Zeit / pending / generate-recurring / cron)

Findings are based on keyword search within `docs/` (and then reading the relevant files listed under “Files read”).

- `docs/access-control.md`
  - Section: **API route protection** (cron route header/secret) and **Environment variables** table.
- `docs/billing-families-variants.md`
  - Section: contains a **Cron** bullet referencing `generate-recurring-trips` behavior (linking, billing copy, geocoding, skipping missing billing).
- `docs/trip-linking-and-cancellation.md`
  - Section heading explicitly present in the file: **“3b. Recurring Cron (`src/app/api/cron/generate-recurring-trips/route.ts`)”**
  - Also references exceptions + `time_tbd` semantics.
- `docs/trip-reschedule-v1.md`
  - Contains a **Zeitabsprache** subsection describing `scheduled_at = null` + `requested_date`.
  - Also mentions the recurring cron in the context of duplicates when rescheduling materialized occurrences.
- `docs/address-autocomplete.md`
  - Mentions recurring rule form and that the **cron geocodes** stored address lines.
- `docs/driving-metrics-api.md`
  - Mentions the **recurring-rule cron** as a server-side caller of cached directions.
- `docs/fremdfirma.md`
  - Mentions recurring rules mirror fields and that the **cron copies** them onto generated trips.
- `docs/bulk-trip-upload.md`
  - Section: **time (optional)** explains the explicit `scheduled_at = NULL` + `requested_date` behavior and states it appears in **Offene Touren**.
  - Also documents placeholder returns from behavior rules with `scheduled_at = NULL`.
- `docs/bulk-upload-behavior-rules.md`
  - Contains an explicit rule: trip appears in **Offene Touren** when `scheduled_at IS NULL`.
  - Discusses placeholder return trip creation with `scheduled_at = NULL`.
- `docs/dispatch-inbox.md`
  - Mentions “Offene Touren” semantics including missing time.
- `docs/date-picker.md`
  - Mentions split date/time and “Zeitabsprache” patterns.
- `docs/trips-duplicate.md`
  - Mentions that a copied leg can remain “zeitoffen” and references `requested_date` alignment.
- `docs/kts-architecture.md`
  - Contains a code map row referencing the recurring cron route (keyword hit: “Recurring cron”).

If any additional doc file contains these keywords beyond the ones above, it did not appear in the `docs/` keyword search results captured during this audit.

---

### 12) Pending plans in `.cursor/plans/` mentioning recurring / cron / generate / pending

Plans found by keyword search under `.cursor/plans/`, with their **pending** todo items (as written in the files):

- `.cursor/plans/refine-client-recurring-trip-behavior_71404970.plan.md`
  - **Pending todos**
    - `review-current-flows`: Re-check current UI flows for client form, recurring rules list, and Offene Touren für Morgen to ensure the conceptual mapping above matches real dispatcher usage.
    - `design-rule-time-mode`: Design a minimal extension to the recurring_rules model to support fixed vs daily-agreement time modes on outbound and/or return legs.
    - `update-recurring-rule-ui`: Update the recurring-rule sheet UX to configure time modes and, when appropriate, hide or require specific time fields accordingly.
    - `adjust-cron-generation`: Adjust the generate-recurring-trips cron to respect the new time modes and avoid generating fixed-time trips for daily-agreement legs.
    - `plan-dashboard-widgets`: Design how tomorrow and same-day dashboard widgets should query trips and rules to surface pending legs that still need a concrete time.

- `.cursor/plans/kts_document_workflow.plan.md`
  - **Pending todo**
    - `recurring-csv-dup`: recurring_rules columns + cron copy; bulk CSV kts_document_applies; duplicate-trips + build-return-trip-insert (see spec for kts_source on copy)
  - (Other pending todos exist but are not recurring-specific; included here only because this todo explicitly mentions recurring + cron + CSV.)

- `.cursor/plans/refactor-create-trip-form_43eb52ea.plan.md`
  - **Pending todos**: multiple refactor tasks; none of the todo contents explicitly mention recurring/crons, but this plan was returned by keyword search (“trip form” context).

- `.cursor/plans/billing_families_variants_98fd187b.plan.md`
  - **Pending todos**: multiple migration and app tasks; the plan text references trip creation and bulk upload. (Cron/recurring are not a primary focus in the todo list itself.)

- `.cursor/plans/neue_regelfahrt_sheet_41fe31fd.plan.md`
  - Todos are **completed** (not pending), but this plan is recurring-rule creation related.

If additional plans mention the keywords but do not contain pending todos relevant to recurring/cron behavior, they are not expanded here beyond what was found in the files read above.

---

## STEP 3 — Senior recommendation stub (based only on findings)

### A) Is a timeless recurring rule currently possible?

- **DB level (recurring rule itself)**:
  - Outbound `recurring_rules.pickup_time` is `string` (non-nullable) in `src/types/database.types.ts`.
  - The form schema enforces a `HH:MM` regex and the payload builder always writes `HH:MM:00`.
  - Therefore, a “timeless outbound recurring rule” (no pickup_time) is **not supported at the DB + form schema level** as currently modeled.

- **Generator level**:
  - The cron **does** support a “no time” case for return legs via `return_mode = 'time_tbd'`, producing trips with `scheduled_at = null` and a sentinel exception key (`'00:00:00'`).
  - The cron does **not** have an outbound “no time” mode; outbound `scheduled_at` is computed from `rule.pickup_time` and the computation happens before the outbound “presence check” in `buildTripPayload`.

### B) Would a trip with `scheduled_at = null` appear in the pending-tours widget?

Yes:

- `useUnplannedTrips` includes trips where `scheduled_at IS NULL` via `.or('scheduled_at.is.null,driver_id.is.null')`.
- The widget renders whatever `useUnplannedTrips` returns, and explicitly counts `trips.filter((t) => !t.scheduled_at)` as “ohne Zeit”.

Note:

- For the `today` / `week` tabs, the hook excludes trips when it cannot derive a date from `scheduled_at`, `linked_trip.scheduled_at`, or `requested_date`. Cron-created timeless return trips set `requested_date`, so they still qualify for these tabs.

### C) Minimum change points to make “rule → generator → timeless trip → widget” work end-to-end

Based on the current code:

- **Return-leg timeless flow** already exists end-to-end (rule `return_mode = 'time_tbd'` → cron `scheduled_at = null` + `requested_date` → `useUnplannedTrips` includes it → widget shows it).

To support a **timeless outbound** recurring rule end-to-end (no outbound time), the minimum change points (locations) implied by the current architecture are:

- `src/types/database.types.ts` / DB schema for `recurring_rules.pickup_time` (currently non-nullable `string`)
- `src/features/clients/components/recurring-rule-form-body.tsx` (`ruleFormSchema` currently requires `pickup_time` to match HH:MM)
- `src/features/clients/lib/build-recurring-rule-payload.ts` (currently always writes `pickup_time: \`${values.pickup_time}:00\``)
- `src/app/api/cron/generate-recurring-trips/route.ts` (outbound `scheduled_at` computation currently assumes a clock time)

### D) Risks / constraints the brainstorm must account for (as evidenced in the files)

- **Deduplication key includes `scheduled_at` and `requested_date`**:
  - The cron’s dedup checks explicitly treat `scheduled_at = null` as part of the key. Any new “timeless outbound” design would need to remain consistent with this keying to avoid duplicate inserts.
- **Dashboard tab filters require a date source** (`today` / `week`):
  - Trips with `scheduled_at = null` need either `requested_date` or `linked_trip.scheduled_at` to be visible outside the `all` tab.
- **Status model is not “timeless-aware”**:
  - No dedicated status for “awaiting time”; the system currently uses `scheduled_at IS NULL` to represent “ohne Zeit”.
- **Downstream consumers may assume `scheduled_at` is present**:
  - Some flows are documented to support Zeitabsprache (`scheduled_at = null` + optional `requested_date`), but any new producer of timeless trips should align with the existing `requested_date` pattern to avoid disappearing from “today/week” filtering.

