# Regelfahrten return trip date — audit

**Date:** 2026-06-01  
**Scope:** Read-only. No code or schema changes.  
**Request:** Allow the return leg of a recurring rule to land on a **different Berlin calendar day** than the outbound leg (default: same day; common case: fixed day offset such as +2).

**Files reviewed:**

| File | Extent |
| --- | --- |
| `src/features/clients/components/recurring-rule-form-body.tsx` | Full |
| `src/features/clients/components/recurring-rule-panel.tsx` | Full |
| `src/features/clients/lib/build-recurring-rule-payload.ts` | Full |
| `src/app/api/cron/generate-recurring-trips/route.ts` | Full |
| `src/features/trips/lib/trip-time.ts` | Full |
| `src/features/trips/lib/trip-business-date.ts` | Full |
| `src/features/trips/lib/recurring-return-mode.ts` | Referenced |
| `docs/features/recurring-rules-overview.md` | Full |
| `docs/plans/recurring-rules-audit.md` | Full |
| `supabase/migrations/*recurring_rules*` | All ALTER migrations (see below) |
| `src/types/database.types.ts` (`recurring_rules`) | Row/Insert types |
| `src/features/clients/components/recurring-rules-list.tsx` | Return display section |
| `src/features/recurring-rules/components/recurring-rules-columns.tsx` | Return column |
| `src/features/dashboard/hooks/use-timeless-rule-trips.ts` | Pairing logic |
| `src/features/trips/api/recurring-exceptions.actions.ts` | Exception keys / pairing |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | Comparison (Neue Fahrt `return_date`) |

**Note:** There is **no** `CREATE TABLE public.recurring_rules` in tracked migrations; the base table predates the ALTER chain. Schema below is from **`database.types.ts`** + migrations.

---

## Current return trip data flow

```
RRule occurrence (outbound calendar day)
  │
  ├─ dateStr := instantToYmdInBusinessTz(occurrence instant)     ← Berlin YMD
  │
  ├─ OUTBOUND leg
  │     requested_date  := dateStr
  │     scheduled_at    := buildScheduledAt(dateStr, pickup_time) | null (timeless)
  │     addresses       := rule.pickup_address / dropoff_address
  │     dedup key       := (client_id, rule_id, requested_date=dateStr, leg=outbound)
  │
  └─ RETURN leg (if return_mode !== 'none')
        requested_date  := dateStr                    ← SAME as outbound (no offset)
        scheduled_at    := buildScheduledAt(dateStr, return_time) | null (time_tbd)
        addresses       := swapped dropoff/pickup strings (+ geo swap)
        exception lookup:= exception_date === dateStr  ← same outbound date
        dedup key       := (client_id, rule_id, requested_date=dateStr, leg=return)
        linked_trip_id  := outbound row id (outbound updated to point at return)
```

There is **no** form field or DB column for return calendar day. The return date is **implicitly the outbound occurrence date** at cron time.

---

## DB schema snapshot (return-relevant)

### `recurring_rules` columns (current generated types)

| Column | Type | Return relevance |
| --- | --- | --- |
| `return_mode` | `text` NOT NULL | `'none' \| 'time_tbd' \| 'exact'` (CHECK constraint) |
| `return_trip` | `boolean` | Legacy flag; kept in sync: `return_mode !== 'none'` on save |
| `return_time` | `time` / `string \| null` | Clock for `exact` mode (`HH:MM:SS` in DB) |
| `pickup_address` | `text` NOT NULL | Outbound pickup; **return pickup = this address** (swapped in cron) |
| `dropoff_address` | `text` NOT NULL | Outbound dropoff; **return dropoff = this address** (swapped) |
| `pickup_lat/lng`, `dropoff_lat/lng` | `float8 \| null` | Outbound coords; cron swaps for return leg |

**Not present:**

- `return_date`, `return_day_offset`, `return_weekday`, `return_pickup_address`, `return_dropoff_address`
- Any column describing return calendar offset or override

### Constraints (from migrations)

| Constraint | Detail |
| --- | --- |
| `recurring_rules_return_mode_check` | `return_mode IN ('none','time_tbd','exact')` |
| `recurring_rules_fremdfirma_payment_mode_check` | Unrelated to return dates |
| `pickup_time` | Nullable (timeless outbound) — unrelated |
| FKs | `client_id`, `payer_id`, `billing_variant_id`, `fremdfirma_id` |

### Migration history (ALTER only)

| Migration | Change |
| --- | --- |
| `20260327120000_recurring_rules_billing.sql` | `payer_id`, `billing_variant_id` |
| `20260328120000_recurring_rules_return_mode.sql` | `return_mode` + backfill from `return_trip` / `return_time` |
| `20260403120000_kts_catalog_and_trips.sql` | KTS columns |
| `20260404103000_no_invoice_fremdfirma_recurring.sql` | no_invoice + Fremdfirma mirror |
| `20260417000000_nullable-pickup-time.sql` | `pickup_time` nullable |
| `20260505120000_add-coords-to-recurring-rules.sql` | lat/lng on rule |
| `20260514120000_reha_schein.sql` | `reha_schein` |

---

## Form schema snapshot (return-relevant)

**Defined in:** `recurring-rule-form-body.tsx` — `ruleFormSchema` + `RuleFormValues` + `getRuleFormDefaults`.

| Field | Type | UI | Persisted to DB |
| --- | --- | --- | --- |
| `return_mode` | `'none' \| 'time_tbd' \| 'exact'` | Select “Rückfahrt” | `return_mode`, `return_trip` |
| `return_time` | `string` optional | `<input type="time">` when `exact` | `return_time` (`HH:MM:SS`) or null |
| *(missing)* | — | — | — |

**All other form fields** (days, start/end, addresses, billing, etc.) affect outbound schedule only.

**Validation:**

- `superRefine`: if `return_mode === 'exact'`, `return_time` required
- No validation on return calendar day (field does not exist)

**Comparison — Neue Fahrt** (`create-trip/schema.ts` + `create-trip-form.tsx`):

- Has separate `return_date: Date` and `return_time`
- On submit: `returnRequestedDate = formatLocalYmd(return_date)` can **differ** from outbound `departure_date`
- Uses `buildScheduledAt(returnYmd, return_time)` for return `scheduled_at`

Regelfahrten form **does not** mirror this pattern today.

---

## Q1 — Where is the return trip section rendered?

| Question | Answer |
| --- | --- |
| **Which component?** | **`RecurringRuleFormBody`** — section “Rückfahrt” (lines 545–619). Shells: **`RecurringRulePanel`** (client column 3), **`RecurringRuleSheet`** (overlay), **`CreateRecurringRuleSheet`** (Regelfahrten overview). |
| **Toggle / time** | `return_mode` Select (`none` / `time_tbd` / `exact`); `return_time` time input when `exact`. Billing can lock mode via `useTripFormData` + `normalizeBillingTypeBehavior`. |
| **Return date source** | **Not in the form.** At cron time, return **`requested_date`** = outbound occurrence **`dateStr`** (same Berlin YMD). |
| **Existing return_date / offset in form or DB?** | **No.** Neither form schema nor `recurring_rules` has return date offset or override fields. |

**Terminology note:** UI labels are **“Rückfahrt mit Zeitabsprache”** (`time_tbd`) and **“Rückfahrt mit genauer Zeit”** (`exact`). Both modes use the **same calendar day** as outbound when materialized.

---

## Q2 — DB schema for return trips today

See **DB schema snapshot** above.

- Return “addresses” are **not** separate columns — return leg reuses **swapped** `pickup_address` / `dropoff_address` from the rule.
- **No** return date offset column.
- **`return_time`** nullable; required in product terms only when `return_mode = 'exact'`.

---

## Q3 — How does the cron generate the return trip?

**Path:** `generate-recurring-trips/route.ts`, inside the `for (const dateUTC of occurrencesUTC)` loop, after outbound insert.

| Step | Code / behaviour |
| --- | --- |
| Skip if no return | `if (returnMode === 'none') continue` |
| Exact guard | `if (returnMode === 'exact' && !rule.return_time) continue` |
| Exception time key | `time_tbd` → `RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME` (`'00:00:00'`); `exact` → `clockToHhMmSs(rule.return_time)` |
| **`scheduled_at`** | `exact`: `scheduledIsoFromBerlinCalendarAndClock(dateStr, …)` → **`buildScheduledAt(dateStr, time)`**. `time_tbd`: **`null`**. |
| **`requested_date`** | Set in **`buildTripPayload`** as `requested_date: dateStr` — **outbound occurrence date**, not a separate return date (lines 346, 632–644, 667–671). |
| **`buildTripPayload`** | `isReturnTrip: true` swaps address strings and coords; same `dateStr` param for exceptions: `e.exception_date === dateStr` |
| Dedup | `insertIfAbsent(..., { requested_date: dateStr, leg: 'return' })` |
| Linking | Outbound row updated: `linked_trip_id = returnId`, `link_type = 'outbound'` |

**Helpers used:** `buildScheduledAt` (via `scheduledIsoFromBerlinCalendarAndClock`), **`instantToYmdInBusinessTz`** for outbound `dateStr` only. **Not** `combineDepartureForTripInsert`.

---

## Q4 — Form / Zod schema

**Location:** `recurring-rule-form-body.tsx` — `ruleFormSchema`, `RuleFormValues`, `getRuleFormDefaults`.

**All fields today:**

`days`, `payer_id`, `billing_variant_id`, `kts_document_applies`, `kts_manual`, `no_invoice_required`, `no_invoice_manual`, `fremdfirma_enabled`, `fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`, `pickup_time`, `pickup_address`, `dropoff_address`, `return_mode`, `return_time`, `start_date`, `end_date`, `is_active`.

**Return validation:** `return_time` required when `return_mode === 'exact'` only.

**Payload mapping:** `build-recurring-rule-payload.ts` maps `return_mode`, `return_trip`, `return_time` — no date offset.

---

## Q5 — What would need to change for return date offset?

| Layer | Change |
| --- | --- |
| **(a) DB** | Add column, e.g. **`return_day_offset integer NOT NULL DEFAULT 0`** with CHECK `return_day_offset >= 0 AND return_day_offset <= 365` (upper bound TBD). Comment: calendar days after outbound occurrence in business TZ. Alternative names: `return_requested_date_offset`. |
| **(b) Form Zod** | Add `return_day_offset: z.number().int().min(0).max(N)` or string coerced to int; show only when `return_mode !== 'none'`. Optional: hide when `0` and use placeholder “Gleicher Tag”. |
| **(c) UI** | **`RecurringRuleFormBody`** — new control in Rückfahrt block. **Recommended:** small **number input** (“Tage nach Hinfahrt”, default `0`) — matches recurring “every Monday + 2 days” product language better than a one-off date picker (rules are pattern-based, not single dates). Weekday selector is a **different product** (absolute weekday vs relative offset) and would need another column or convention. |
| **(d) `buildRecurringRulePayload`** | Persist `return_day_offset` (omit or force `0` when `return_mode === 'none'`). |
| **(e) Cron** | After `dateStr` (outbound YMD): compute `returnDateStr = addDaysInBusinessTz(dateStr, rule.return_day_offset ?? 0)`. Use **`returnDateStr`** for return leg: `buildTripPayload({ dateStr: returnDateStr, … })`, `insertIfAbsent` dedup, `buildScheduledAt(returnDateStr, …)`. Keep **outbound** on `dateStr`. |
| **(f) Types** | Regenerate / extend `database.types.ts`; `InsertRecurringRule` / service types. |
| **(g) Edge systems** | See risk table — exceptions, widgets, display. |

**Integer offset feasibility:** **Yes**, for the stated “+2 days after outbound” case. Constraints:

- Must apply offset in **Berlin calendar** (use `addDays` with `@date-fns/tz` + `getTripsBusinessTimeZone()`, not UTC `Date` math).
- **Does not** encode “return always on Friday regardless of outbound weekday” — that would need `BYDAY` on a second rrule or a weekday enum, not a simple integer.
- Large offsets may place return **`requested_date`** outside the cron’s 14-day generation window while outbound is inside — product may need window extension or accept that return appears on a later cron run.

---

## Q6 — Safest default for existing rules

| Topic | Recommendation |
| --- | --- |
| **Default for new column** | **`0`** — same calendar day as outbound; preserves current behaviour. |
| **Migration** | `ADD COLUMN return_day_offset integer NOT NULL DEFAULT 0` — no backfill script needed. |
| **Existing rows with return** | All continue same-day until admin edits rule. **No** automatic regeneration of already-materialized trips. |
| **Materialized trips** | Existing `trips` rows keep old `requested_date`; changing a rule offset affects **future** cron inserts only (dedup prevents duplicate same leg+date). |

---

## Q7 — Other readers / display of return date from rules

| Location | Shows return **date**? | Shows return **time/mode**? |
| --- | --- | --- |
| **`recurring-rules-list.tsx`** (client detail) | **No** — only weekday pattern + validity range | Yes — time or “Zeitabsprache”; swapped addresses |
| **`recurring-rules-columns.tsx`** (Regelfahrten table) | **No** | `return_mode` column: “Zeitabsprache” or `return_time` HH:mm |
| **`recurring-rules-overview.md`** | N/A | Documents timeless pairing by `(rule_id, requested_date, client_id)` |
| **`use-timeless-rule-trips.ts`** | Uses **`trips.requested_date`**, not rule columns | Pairs via **`linked_trip_id`** first; key `${rule_id}\|${requested_date}\|${client_id}` assumes same day for unlinked fallback |
| **`recurring-exceptions.actions.ts`** | Exception **`exception_date`** tied to trip `requested_date` / scheduled UTC slice | Return TBD uses `requested_date` + sentinel time |
| **Cron** | N/A | Only consumer that would read new `return_day_offset` |

**No UI today** displays or edits a return calendar offset on the rule row.

---

## Risk table — adding nullable/non-null integer `return_day_offset`

| Area | Risk if offset > 0 | Mitigation |
| --- | --- | --- |
| **Cron dedup** | Low | Separate `requested_date` per leg already supported (`leg` + `requested_date`). |
| **Outbound↔return link** | Low | Still linked by `linked_trip_id`; dates may differ. |
| **Exception matching in cron** | **Medium** | Today return exceptions use **`exception_date === outbound dateStr`**. Should use **`returnDateStr`** for return leg lookup (and skip-occurrence UX must target correct date). |
| **Timeless widget pairing** | **Low–medium** | Primary path uses **`linked_trip_id`** — OK cross-day. Secondary dedup key uses return row’s `requested_date`; outbound may show alone in edge cases if link missing. |
| **`findPairedTrip` fallback** | **Medium** | Same-`scheduled_at` UTC day fallback fails cross-day; **`linked_trip_id`** path still works for cron-generated pairs. |
| **Fahrten day filter** | Low | Outbound and return appear on **different** filter days — intended. |
| **Regelfahrten list / table** | Low | No date shown today; optional enhancement “Rückfahrt +2 Tage”. |
| **Neue Fahrt parity** | N/A | Manual create already supports different return date; recurring would catch up conceptually. |
| **Weekday-specific return** | **Out of scope** | Integer offset cannot express “always Friday”; needs separate design. |

---

## Senior recommendation

### (a) Simplest safe schema change

```sql
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS return_day_offset integer NOT NULL DEFAULT 0;

ALTER TABLE public.recurring_rules
  ADD CONSTRAINT recurring_rules_return_day_offset_check
  CHECK (return_day_offset >= 0 AND return_day_offset <= 30);

COMMENT ON COLUMN public.recurring_rules.return_day_offset IS
  'Calendar days after each outbound occurrence (business TZ) for the return leg requested_date. 0 = same day as Hinfahrt.';
```

- **Name:** `return_day_offset` (integer, days after outbound occurrence).
- **Default:** `0` for all existing and new rows until user changes it.
- **Cap:** 30 (or 14 to match cron window) — product decision.
- Regenerate **`database.types.ts`** after migration.

### (b) UI approach

**Prefer: number input “Tage nach Hinfahrt” (min 0, default 0)** in the existing Rückfahrt panel when `return_mode !== 'none'`.

| Option | Fit |
| --- | --- |
| **Integer day offset** | **Best** — matches “2 days later every week”; aligns with recurring pattern model. |
| **Date picker** | **Poor** — rules repeat weekly; a single calendar date does not generalize. |
| **Weekday selector** | **Different feature** — “return on Friday” ≠ “+2 days”; needs separate spec. |

Mirror Neue Fahrt **wording** (“Rückfahrtdatum”) only if product later adds per-occurrence exceptions, not for the rule template.

Optional UX: when offset is `0`, show helper text “Am selben Tag wie die Hinfahrt” (current behaviour).

### (c) Cron change

After computing outbound `dateStr`:

```typescript
// Pseudocode — use trip-business-date helper (new or inline)
const returnDateStr =
  (rule.return_day_offset ?? 0) === 0
    ? dateStr
    : addYmdDaysInBusinessTz(dateStr, rule.return_day_offset);

// Outbound: unchanged (dateStr)
// Return buildTripPayload + insertIfAbsent + exception lookup: returnDateStr
// Return scheduled_at: buildScheduledAt(returnDateStr, return_time) when exact
```

Add **`addYmdDaysInBusinessTz(ymd, days)`** to `trip-business-date.ts` (single place, Berlin-safe) rather than ad hoc cron math.

Update **return** exception filter: `e.exception_date === returnDateStr` (not `dateStr`).

### (d) Scope estimate

| Scope | Rationale |
| --- | --- |
| **Medium** | Not a one-line cron tweak: migration + types + form + payload + cron + exception path review + optional list/display copy. No second rrule engine. |
| **Small** if offset only, no weekday mode, no backfill, no exception UI changes in v1. |
| **Large** if adding weekday-based return, exception UI overhaul, timeless widget redesign, or backfill/repair of existing materialized trips. |

**Suggested v1:** `return_day_offset` integer (0–30), form number input, cron + payload + types, exception lookup fix for return leg, one line in Regelfahrten list optional (“+N Tage”). Defer weekday selector and trip backfill.

---

## Related docs

- [`docs/features/recurring-rules-overview.md`](../features/recurring-rules-overview.md) — timeless widget pairing
- [`docs/plans/recurring-rules-audit.md`](./recurring-rules-audit.md) — schema inventory (pre-coords; types now include lat/lng)
- [`docs/trip-linking-and-cancellation.md`](../trip-linking-and-cancellation.md) — recurring cron linking
- [`docs/plans/regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md) — outbound weekday DTSTART fix (shipped)
