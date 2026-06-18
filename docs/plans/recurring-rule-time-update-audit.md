# Recurring rule time update — read-only audit

**Date:** 2026-06-17  
**Status: Resolved** — implemented via the [recurring trip resync plan](../../.cursor/plans/recurring_trip_resync_2309cc40.plan.md). `runUpdateWithCleanup` now detects schedule changes and calls `resyncFutureRecurringTrips` to bulk-patch `scheduled_at` on all future pending trips.  
**Scope:** Read-only code review. No code, schema, or data changes.  
**Reported scenario:** User changed an existing rule’s departure time from 13:45 to 13:30 in `RecurringRulePanel` and saved. The non–end-date path ran `runUpdateWithCleanup(existingRule.id, payload, null)`. Already-generated future trips kept the old time.

## Files read

| Path | Role |
|------|------|
| `src/features/clients/lib/recurring-rule-submit-flow.ts` | `runUpdateWithCleanup`, `runCreateWithGeneration` |
| `src/features/clients/lib/build-recurring-rule-payload.ts` | Form → DB payload mapping |
| `src/features/trips/api/recurring-rules.service.ts` | `getRuleById`, trip count/delete helpers (no update method) |
| `src/features/trips/api/recurring-rules.actions.ts` | `updateRecurringRule`, `deleteFutureTripsAfterDate`, `triggerGenerationForRule` |
| `src/features/clients/components/recurring-rule-panel.tsx` | Edit submit flow |
| `src/features/clients/components/recurring-rule-sheet.tsx` | Same update flow (sheet variant) |
| `src/features/clients/components/recurring-rule-form-body.tsx` | `pickup_time` form field, Zod schema, `getRuleFormDefaults` |
| `src/lib/recurring-trip-generator.ts` | Materialisation, dedup, `scheduled_at` from rule time |
| `src/app/api/cron/generate-recurring-trips/route.ts` | Nightly cron entry (delegates to generator) |
| `src/features/trips/lib/recurring-trip-cleanup-predicate.ts` | End-date shorten trip filter |
| `src/types/database.types.ts` | `recurring_rules` and `trips` column names |
| `supabase/migrations/20260417000000_nullable-pickup-time.sql` | `pickup_time` nullability |
| `docs/features/recurring-rules-overview.md` | Create vs update generation behaviour |
| `docs/plans/regelfahrten-cron-audit.md` | Dedup invariant, update-only rule writes |
| `docs/plans/cron-trip-generation-audit.md` | Cron / generator architecture |
| `docs/plans/recurring-rules-audit.md` | Schema and write-path inventory |

**Edge functions:** `supabase/functions/` is empty in this repo. No Supabase Edge Function participates in rule update or trip generation.

**Naming note:** The recurring-rule UI uses **`pickup_time`** (label “Abholzeit”), not `departure_time`. One-off trips use `departure_date` / `departure_time` in the create-trip form; recurring rules store time on `recurring_rules.pickup_time` and copy it into `trips.scheduled_at` at generation time.

---

## 1. `runUpdateWithCleanup` with `newEnd = null`

**Source:** `src/features/clients/lib/recurring-rule-submit-flow.ts` lines 52–76.

### What it does when `newEnd` is null

1. **Skips trip deletion entirely.** The `if (newEnd)` block (lines 59–68) is not entered, so `deleteFutureTripsAfterDate` is never called and `deleted` stays `0`.
2. **Updates the rule row** by calling `updateRecurringRule(ruleId, payload)` (server action in `recurring-rules.actions.ts`).
3. **Returns** `{ deleted: 0 }`.

### Does it update `recurring_rules`?

**Yes.** `updateRecurringRule` runs a Supabase `.update(updates).eq('id', id)` on `recurring_rules` (lines 84–89 of `recurring-rules.actions.ts`). The full `payload` from `buildRecurringRulePayload` is passed through (plus optional geocode fields when addresses change).

### Does it touch already-generated trips?

**No.** With `newEnd = null`, no code in this path reads, updates, or deletes rows in `trips`.

### Delete / regenerate / patch future trips?

| Operation | On field-change update (`newEnd = null`) |
|-----------|------------------------------------------|
| Delete future trips | No |
| Regenerate / re-materialise | No — `triggerGenerationForRule` is **not** called after update (only after create via `runCreateWithGeneration`) |
| Patch `scheduled_at` on existing trips | No |

Trip cleanup in this flow exists **only** for end-date shortening (`newEnd` is a `yyyy-MM-dd` string), and only after `ShortenEndDateDialog` confirmation. That path deletes `pending` trips with `requested_date > newEnd` via `deleteFutureTripsAfterDate`; it does not run for a pure time change.

---

## 2. `buildRecurringRulePayload`

**Source:** `src/features/clients/lib/build-recurring-rule-payload.ts`.

### Form field → DB column mapping

| Form (RHF) | DB column (`recurring_rules`) | Transform |
|------------|-------------------------------|-----------|
| `pickup_time` | `pickup_time` | `HH:MM` → `HH:MM:00`, or `null` if empty |
| `return_time` | `return_time` | Same pattern when `return_mode === 'exact'` |
| (no `departure_time` on this form) | — | — |

Relevant lines:

```96:104:src/features/clients/lib/build-recurring-rule-payload.ts
    pickup_time: values.pickup_time ? `${values.pickup_time}:00` : null,
    ...
    return_time:
      values.return_mode === 'exact' && values.return_time
        ? `${values.return_time}:00`
        : null,
```

### Correctness for 13:45 → 13:30

- Form value from `<Input type="time">` is `HH:MM` (e.g. `"13:30"`).
- Payload becomes `pickup_time: "13:30:00"`.
- Load path: `getRuleFormDefaults` maps DB → form with `initialData.pickup_time.substring(0, 5)` (e.g. `"13:45:00"` → `"13:45"`).

**Conclusion:** Mapping is correct. There is no silent drop or wrong column name for a normal time edit. Empty time correctly becomes `null` (daily-agreement / timeless outbound mode).

### Validation

`ruleFormSchema` accepts `pickup_time` as either `''` or a string matching `^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$`. A valid browser time input passes.

---

## 3. `recurringRulesService.update` / `getRuleById`

### `recurringRulesService.update`

**There is no `update()` method** on `recurringRulesService`. The service (`recurring-rules.service.ts`) exposes:

- `getClientRules`
- `getRuleById`
- `countFutureTripsAfterDate`
- `deleteRule`

Rule updates go through the **server action** `updateRecurringRule` in `recurring-rules.actions.ts`, invoked from `runUpdateWithCleanup`.

### `getRuleById`

```54:64:src/features/trips/api/recurring-rules.service.ts
  async getRuleById(id: string) {
    ...
    const { data, error } = await supabase
      .from('recurring_rules')
      .select('*')
      ...
```

Returns the full row, including `pickup_time`.

### What columns does the update PATCH include?

`updateRecurringRule` spreads the entire `payload: UpdateRecurringRule` into `updates` and writes it with `.update(updates)`. There is **no field whitelist** that omits `pickup_time`.

Fields in a typical panel save (from `buildRecurringRulePayload`):

`client_id`, `rrule_string`, `payer_id`, `billing_variant_id`, `kts_document_applies`, `kts_source`, `no_invoice_required`, `no_invoice_source`, `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`, **`pickup_time`**, `pickup_address`, `dropoff_address`, `return_mode`, `return_trip`, **`return_time`**, `start_date`, `end_date`, `is_active`.

If pickup or dropoff address strings change, geocoding may add `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` to the same update.

**`pickup_time` is explicitly included** in the update payload when the user saves the form.

### DB / RPC layer

No Postgres RPC or Edge Function wraps the update. It is a direct Supabase client `.update()` on `recurring_rules`.

---

## 4. Future trips after a rule update (non–end-date change)

### Mechanism to patch or regenerate existing future trips?

**None today.** After `runUpdateWithCleanup(..., null)`:

- The rule row may reflect the new time.
- Existing `trips` rows are unchanged.

Documented in `docs/features/recurring-rules-overview.md`: on-demand generation (`triggerGenerationForRule`) runs **after create only**, not after edit.

### Trip-generation paths that could re-sync

| Trigger | When | Effect on existing trips |
|---------|------|---------------------------|
| `triggerGenerationForRule(ruleId)` | After **create** (`runCreateWithGeneration`) | Inserts **missing** legs only |
| `GET /api/cron/generate-recurring-trips` | Nightly (Vercel `0 3 * * *` UTC) | Same generator, all active rules |
| `generateRecurringTrips({ ruleId })` | Shared implementation in `recurring-trip-generator.ts` | See dedup below |

**Dedup behaviour** (`insertIfAbsent` / `findExistingRecurringLegId`): before insert, the generator looks up an existing trip by `(client_id, rule_id, requested_date, leg)`. If found, it **increments `tripsSkipped` and does not update** `scheduled_at` or any other column.

```370:383:src/lib/recurring-trip-generator.ts
  async function insertIfAbsent(...) {
    const existing = await findExistingRecurringLegId(dedupKey);
    if (existing) {
      tripsSkipped++;
      return existing;
    }
    // ... insert only when absent
```

So **re-running generation alone cannot fix times** on trips that already exist for those dates. Nightly cron will also skip them.

`scheduled_at` on generated outbound legs is computed once at insert from `rule.pickup_time` (and exceptions) via `buildScheduledAt` / `scheduledIsoFromBerlinCalendarAndClock` — it is not re-derived on later rule edits.

### DB relationship: rule → trips

| Concept | Detail |
|---------|--------|
| Table for generated legs | `public.trips` only — **no `generated_trips` table** in this codebase |
| Link column | `trips.rule_id` → `recurring_rules.id` |
| Provenance | `trips.ingestion_source = 'recurring_rule'` on insert |
| Hin/Rück pairing | `trips.linked_trip_id`, `trips.link_type` (`outbound` / `return`) |
| FK in types | `database.types.ts` lists `rule_id` on `trips` but does not expose a generated `trips_rule_id_fkey` relationship; application code treats `rule_id` as the authoritative link |

Per-occurrence overrides live in `recurring_rule_exceptions` (`rule_id`, `exception_date`, `original_pickup_time`, `modified_pickup_time`, etc.). A rule-level time change does not rewrite those rows.

---

## 5. DB schema check

From `src/types/database.types.ts` and migrations:

### `recurring_rules` — departure / pickup time

| Item | Value |
|------|--------|
| Column name | **`pickup_time`** (`string \| null`) |
| Not present | `departure_time`, `uhrzeit` |
| Storage format | Time string, typically `HH:MM:SS` (app writes `:00` seconds) |
| Nullability | Nullable since `20260417000000_nullable-pickup-time.sql` |

### `trips` — departure / pickup time

| Item | Value |
|------|--------|
| Column name | **`scheduled_at`** (`timestamptz`, `string \| null` in types) |
| Not present | `departure_time`, `pickup_time` |
| Meaning | Absolute instant for the leg; for recurring outbound legs, derived from `requested_date` + rule `pickup_time` at generation time |

### Rule → trip link

| Item | Value |
|------|--------|
| Column | `trips.rule_id` (`uuid`, nullable) |
| Set on generation | `rule_id: rule.id` in `buildTripPayload` |
| `generated_trips` | Does not exist |

---

## 6. Senior recommendation

### Most likely reason the time change did not propagate

**Architectural gap, not a mapping bug.**

1. **The update path is rule-only.** `runUpdateWithCleanup(..., null)` updates `recurring_rules` and stops. It never touches `trips` and never calls `triggerGenerationForRule`.
2. **The generator is insert-only with dedup.** Even if the rule row now has `pickup_time = '13:30:00'`, cron and on-demand generation **skip** dates that already have a `rule_id`-linked trip.
3. **Therefore existing future trips keep the `scheduled_at` computed at insert** (from the old `13:45:00` rule time).

The rule record **most likely was updated** correctly unless the save failed (user would see an error toast). The symptom (future trips unchanged) matches the code even when the rule save succeeds.

Less likely alternate causes (not supported as primary by this read):

- Wrong column name / payload omission — **ruled out** (`pickup_time` is mapped and included).
- User edited a different field label mentally (“departure”) but form still uses `pickup_time` — same column path.

### Minimal correct fix (assessment)

| Option | Verdict |
|--------|---------|
| **(a) Patch rule only + re-run generation** | **Insufficient.** Dedup prevents updates to existing rows; only net-new dates would get the new time. |
| **(b) Update rule + bulk-update future trips** | **Correct for time-only changes.** For `pending` (and product-defined status set) trips with `rule_id = rule.id` and `requested_date >= today` (Berlin), recompute `scheduled_at` from `requested_date` + new `pickup_time` / `return_time` (respect `recurring_rule_exceptions`). Surgical; preserves trip IDs, assignments, and exceptions where applicable. |
| **(c) Something else** | **Pragmatic alternative:** delete eligible future `pending` recurring legs for the rule, then `triggerGenerationForRule(ruleId)` — reuses generator and pricing/geocode paths but is heavier (new IDs, link rewiring, exception `original_pickup_time` keys may need care). |

**Recommended minimal product fix:** **(b)** — after a successful rule update that changes schedule fields (`pickup_time`, `return_time`, `return_mode`, or addresses that affect legs), **bulk-patch** future non-terminal trips linked via `rule_id`, or introduce a shared “resync future recurring trips” server action that either patches or delete-and-regenerates `pending` legs only.

**Smallest engineering hook:** extend `runUpdateWithCleanup` (or `updateRecurringRule` post-hook) to detect schedule-relevant diffs vs `existingRule`, then run that resync — mirroring how end-date shortening already has a dedicated trip cleanup branch.

**Immediate operator workaround (no code):** manually reschedule affected future trips in the Fahrten UI, or SQL/admin patch of `scheduled_at` for `rule_id` + future `requested_date` rows — not ideal but consistent with current behaviour.

---

## Summary table

| Layer | Updates on field-change save? | Propagates new time to existing future trips? |
|-------|------------------------------|-----------------------------------------------|
| `recurring_rules.pickup_time` | Yes (via `updateRecurringRule`) | N/A |
| `trips.scheduled_at` | No | No |
| Nightly cron | No (skips existing) | No |
| `triggerGenerationForRule` after edit | Not called | No |
