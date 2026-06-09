# Regelfahrten / recurring-trip cron — read-only audit

**Date:** 2026-06-09  
**Scope:** Read-only inventory of cron scheduling, trip generation, form flows, deletion semantics, shared helpers, and related plans/docs. No code or schema changes.

---

## Inventory: what was read

| Area | Finding |
| --- | --- |
| `supabase/functions/` | **Does not exist** in this repo. Trip generation is **not** implemented as a Supabase Edge Function. |
| `supabase/schema.sql` | **Not present**. Schema inferred from `src/types/database.types.ts` + `supabase/migrations/`. |
| Cron implementation | `src/app/api/cron/generate-recurring-trips/route.ts` (Next.js App Router API route, `GET` handler). |
| pg_cron in repo | Only `supabase/migrations/20260521120000_live_locations_cron_cleanup.sql` (stale `live_locations` cleanup). **Not** used for Regelfahrten. |

### Recurring-rules migrations (ALTER only; no `CREATE TABLE recurring_rules` in tracked migrations)

| Migration | Change |
| --- | --- |
| `20260327120000_recurring_rules_billing.sql` | `payer_id`, `billing_variant_id` |
| `20260328120000_recurring_rules_return_mode.sql` | `return_mode` + CHECK + backfill |
| `20260403120000_kts_catalog_and_trips.sql` | KTS columns on `recurring_rules` |
| `20260404103000_no_invoice_fremdfirma_recurring.sql` | no_invoice + Fremdfirma mirror |
| `20260417000000_nullable-pickup-time.sql` | `pickup_time` nullable |
| `20260505120000_add-coords-to-recurring-rules.sql` | `pickup_lat/lng`, `dropoff_lat/lng` |
| `20260514120000_reha_schein.sql` | `reha_schein` on rules |

### Related plan files (`.cursor/plans/`)

| File | Topic |
| --- | --- |
| `refine-client-recurring-trip-behavior_71404970.plan.md` | Timeless/daily-agreement legs, cron behavior |
| `neue_regelfahrt_sheet_41fe31fd.plan.md` | Create flow from `/dashboard/regelfahrten` |
| `fahrten_trip_presets_0bf7554a.plan.md` | Trip presets |
| `cancel_trip_driver_and_print_622234a2.plan.md` | Trip cancellation |
| `phase_3_trip_edit_pricing_0ec97e02.plan.md` | Trip edit pricing |
| `driver_availability_read_model_47496427.plan.md` | Driver availability (open) |

### Related docs (`docs/`)

| Doc | Topic |
| --- | --- |
| `docs/features/recurring-rules-overview.md` | Regelfahrten overview page, cron semantics, timeless widget |
| `docs/plans/cron-trip-generation-audit.md` | Prior cron/timezone audit (partially superseded by Phase 2 fixes) |
| `docs/plans/regelfahrten-cron-day-offset-audit.md` | DTSTART weekday offset fix |
| `docs/plans/regelfahrten-return-date-audit.md` | Return leg same-day constraint |
| `docs/plans/recurring-rule-expiry-alert-audit.md` | `end_date` expiry banner; notes orphaned trips after shorten |
| `docs/plans/recurring-rules-audit.md` | Plan C coordinates |
| `docs/trips-date-filter.md` | Berlin TZ write-path inventory (includes cron) |
| `docs/trip-linking-and-cancellation.md` | Hin/Rück linking + cancel modes |
| `docs/access-control.md` | `CRON_SECRET` auth for cron route |

---

## 1. Cron function location and trigger mechanism

### 1.1 Exact name and file path

There is **no Supabase Edge Function** for recurring trip generation.

| Property | Value |
| --- | --- |
| **Logical name** | `generate-recurring-trips` |
| **HTTP path** | `GET /api/cron/generate-recurring-trips` |
| **File path** | `src/app/api/cron/generate-recurring-trips/route.ts` |
| **Export** | `export async function GET(request: NextRequest)` |
| **Runtime** | Next.js Route Handler on Vercel (Node), `export const dynamic = 'force-dynamic'` |

### 1.2 How it is scheduled

**Primary scheduler: Vercel Cron** (not Supabase `pg_cron`, not an external cron service in-repo).

From `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/generate-recurring-trips",
      "schedule": "0 3 * * *"
    }
  ]
}
```

| Property | Value |
| --- | --- |
| **Schedule expression** | `0 3 * * *` |
| **Interpretation** | Daily at **03:00 UTC** (Vercel cron uses UTC) |
| **Mechanism** | Vercel invokes `GET` on the deployed app path; sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured in the project |

**pg_cron in this repo** exists only for `live_locations` cleanup (`*/5 * * * *`) — unrelated to Regelfahrten.

### 1.3 On-demand trigger

**No frontend or admin UI** calls the cron after saving a rule (confirmed: no `fetch('/api/cron/...')`, no `supabase.functions.invoke` anywhere in `src/`).

**Manual / scripted on-demand invocation is supported** via authenticated HTTP:

```68:83:src/app/api/cron/generate-recurring-trips/route.ts
export async function GET(request: NextRequest) {
  try {
    // 1) Auth — fail closed if secret not configured (never run unprotected).
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Vercel Cron sends CRON_SECRET as Authorization: Bearer <token>.
    const authorization = request.headers.get('authorization');
    const bearerMatches = authorization === `Bearer ${cronSecret}`;
    // Fallback for manual / scripted calls (e.g. curl with custom header).
    const headerSecret = request.headers.get('x-cron-secret');
    const xCronMatches = headerSecret === cronSecret;
    if (!bearerMatches && !xCronMatches) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
```

Example manual call (from `docs/access-control.md` / `env.example.txt`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-deployment>/api/cron/generate-recurring-trips"
# or
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<your-deployment>/api/cron/generate-recurring-trips"
```

**Requirements for on-demand runs:** `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service role bypasses RLS for cross-tenant inserts).

---

## 2. Trip generation logic

### 2.1 Date range / horizon

The cron uses a **rolling 14-day forward window** from **Berlin “today”**, intersected with each rule’s `start_date`, `end_date`, and RRule occurrences.

```104:108:src/app/api/cron/generate-recurring-trips/route.ts
    const inTz = tz(getTripsBusinessTimeZone());
    const todayLocal = startOfDay(inTz(Date.now()), { in: inTz });
    const windowEndLocal = endOfDay(addDays(todayLocal, 14, { in: inTz }), {
      in: inTz
    });
```

Per-rule bounds:

```488:518:src/app/api/cron/generate-recurring-trips/route.ts
      const ruleStartDateLocal = startOfDay(inTz(rule.start_date), {
        in: inTz
      });
      const ruleEndDateLocal = rule.end_date
        ? endOfDay(inTz(rule.end_date), { in: inTz })
        : windowEndLocal;

      // ...

      const searchStartLocal = isAfter(todayLocal, ruleStartDateLocal)
        ? todayLocal
        : ruleStartDateLocal;
      const searchEndLocal = isBefore(windowEndLocal, ruleEndDateLocal)
        ? windowEndLocal
        : ruleEndDateLocal;

      if (isAfter(searchStartLocal, searchEndLocal)) continue;
```

| Scenario | Effective generation end |
| --- | --- |
| `end_date` **set** | `min(today + 14 Berlin days, end_date end-of-day Berlin)` |
| `end_date` **null** | `today + 14 Berlin days` only (open-ended rule; no rule-level cap beyond horizon) |
| `start_date` in future | Occurrences only from `start_date` onward |
| `is_active = false` | Rule excluded entirely (`eq('is_active', true)` on select) |

**Answer:** Trips are generated up to **14 days ahead** and **never beyond `end_date`** when `end_date` is set. The cron does **not** materialize the full rule lifetime in one run.

### 2.2 Link back to parent Regelfahrt rule

Generated trips store:

| Field | Table | Purpose |
| --- | --- | --- |
| `rule_id` | `public.trips` | UUID of parent `recurring_rules.id` |
| `ingestion_source` | `public.trips` | Set to `'recurring_rule'` on insert |

```367:368:src/app/api/cron/generate-recurring-trips/route.ts
        rule_id: rule.id,
        ingestion_source: 'recurring_rule',
```

**Note:** `database.types.ts` lists `trips.rule_id` as a column but **does not** expose a `trips_rule_id_fkey` relationship in generated types (FK may be missing in live DB or not reflected in types). Operational code treats `rule_id` as the parent link.

Hin/Rück pairs additionally use `linked_trip_id` and `link_type` (`'outbound'` / `'return'`).

### 2.3 Tables

| Role | Table |
| --- | --- |
| **Regelfahrt rules** | `public.recurring_rules` |
| **Generated trips** | `public.trips` |
| **Per-occurrence overrides / skips** | `public.recurring_rule_exceptions` |

**`recurring_rules` columns (from `database.types.ts`):** `id`, `client_id`, `rrule_string`, `pickup_address`, `dropoff_address`, `pickup_lat/lng`, `dropoff_lat/lng`, `pickup_time`, `return_mode`, `return_trip`, `return_time`, `start_date`, `end_date`, `is_active`, `payer_id`, `billing_variant_id`, KTS/no-invoice/Fremdfirma/reha fields, `created_at`.

**Dedup invariant** (one outbound + one return per rule per `requested_date`):

```377:400:src/app/api/cron/generate-recurring-trips/route.ts
    async function findExistingRecurringLegId(q: {
      client_id: string;
      rule_id: string;
      requested_date: string;
      leg: 'outbound' | 'return';
    }): Promise<string | null> {
      // WHY no scheduled_at in dedup: after fixing UTC encoding, legacy wrong instants would not
      // `.eq` new rows — cron would duplicate. One outbound + one return per rule per requested_date is the invariant.
      let query = supabase
        .from('trips')
        .select('id')
        .eq('client_id', q.client_id)
        .eq('rule_id', q.rule_id)
        .eq('requested_date', q.requested_date);
      // ... link_type filter for outbound vs return ...
```

---

## 3. End-date / deletion scenario

### 3.1 What happens when `end_date` is shortened?

**Current behavior on rule update:** `updateRecurringRule` in `recurring-rules.actions.ts` only **updates the `recurring_rules` row**. There is **no** trip cleanup, no exception rewrite, and **no** cron invocation.

```35:88:src/features/trips/api/recurring-rules.actions.ts
export async function updateRecurringRule(
  id: string,
  payload: UpdateRecurringRule
): Promise<{ data: RecurringRule | null; error: string | null }> {
  const supabase = await createClient();
  // ... optional geocode on address change ...
  const { data, error } = await supabase
    .from('recurring_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  // ...
}
```

| Effect | Behavior |
| --- | --- |
| **Future cron runs** | Will not generate occurrences **after** the new `end_date` (search window capped by `ruleEndDateLocal`). |
| **Already materialized trips** with `requested_date > new end_date` | **Untouched** — remain in `trips` with `rule_id` still set. |
| **Orphan semantics** | Trips are not orphaned (`rule_id` remains valid); they are **stale/extra** relative to the shortened rule. |

This is explicitly noted in `docs/plans/recurring-rule-expiry-alert-audit.md`: *"existing timed trips after `end_date` may still exist until manually cancelled."*

There is **no** confirmation dialog when shortening `end_date` in the Regelfahrten form.

### 3.2 Existing deletion / cleanup logic for future rule-linked trips

#### A. Rule delete (optional future-trip purge)

`recurringRulesService.deleteRule(id, deleteFutureTrips)`:

```66:98:src/features/trips/api/recurring-rules.service.ts
  async deleteRule(id: string, deleteFutureTrips: boolean = false) {
    const supabase = createClient();

    if (deleteFutureTrips) {
      const today = todayYmdInBusinessTz();
      const { error: tripError } = await supabase
        .from('trips')
        .delete()
        .eq('rule_id', id)
        .gte('requested_date', today)
        .not('status', 'in', '("completed","cancelled")')
        .or('ingestion_source.eq.recurring_rule,ingestion_source.is.null');

      if (tripError) throw tripError;
    }

    const { error } = await supabase
      .from('recurring_rules')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
```

Triggered from `DeleteRecurringRuleDialog` (default `deleteFutureTrips = true`).

#### B. Cancel entire series from a trip (soft cancel, not delete)

`cancelRecurringSeries` in `recurring-exceptions.actions.ts`:

```259:316:src/features/trips/api/recurring-exceptions.actions.ts
export async function cancelRecurringSeries(
  trip: Trip,
  reason?: string
): Promise<CancelResult> {
  // ...
  await supabase
    .from('recurring_rules')
    .update({ is_active: false })
    .eq('id', trip.rule_id);

  // Timed legs: future scheduled_at
  await supabase
    .from('trips')
    .update({ status: 'cancelled', driver_id: null, canceled_reason_notes: reason ?? null })
    .eq('rule_id', trip.rule_id)
    .gte('scheduled_at', new Date().toISOString())
    .eq('status', 'pending');

  // Timeless legs: scheduled_at null, requested_date >= today (device-local todayStr)
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  await supabase
    .from('trips')
    .update({ status: 'cancelled', driver_id: null, canceled_reason_notes: reason ?? null })
    .eq('rule_id', trip.rule_id)
    .is('scheduled_at', null)
    .gte('requested_date', todayStr)
    .eq('status', 'pending');
}
```

#### C. Skip single occurrence

`skipRecurringOccurrence` inserts into `recurring_rule_exceptions` with `is_cancelled: true` and cancels the materialized trip row.

**No dedicated `deleteTripsAfterDate(ruleId, newEndDate)` helper exists.**

---

## 4. Frontend — Regelfahrten form

### 4.1 Components and shared form body

| Component | Path | Modes |
| --- | --- | --- |
| **`RecurringRuleFormBody`** | `src/features/clients/components/recurring-rule-form-body.tsx` | Shared fields + Zod schema |
| **`RecurringRuleSheet`** | `src/features/clients/components/recurring-rule-sheet.tsx` | Create + edit (Sheet overlay; client detail page) |
| **`RecurringRulePanel`** | `src/features/clients/components/recurring-rule-panel.tsx` | Create + edit (Miller column 3) |
| **`CreateRecurringRuleSheet`** | `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx` | Create only (two-step: pick client → form; `/dashboard/regelfahrten`) |

Payload builder: `src/features/clients/lib/build-recurring-rule-payload.ts`  
Server actions: `src/features/trips/api/recurring-rules.actions.ts` (`createRecurringRule`, `updateRecurringRule`)

### 4.2 Create vs edit — same component?

**Same form body, different shells:**

- **Create and edit** share `RecurringRuleFormBody` + `buildRecurringRulePayload` + server actions.
- **Edit** is distinguished by `initialData` / `existingRule` / `ruleId !== 'new'`.
- **Overview page** (`/dashboard/regelfahrten`) supports **create only** via `CreateRecurringRuleSheet`; row edit is deferred — links go to client Stammdaten (`docs/features/recurring-rules-overview.md`).

### 4.3 Save handlers (full)

#### `RecurringRuleSheet.handleSubmit`

```162:201:src/features/clients/components/recurring-rule-sheet.tsx
  const handleSubmit = async (values: RuleFormValues) => {
    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId,
        payers,
        billingTypes
      });

      if (initialData) {
        const payload = { ...ruleData };
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        const { error } = await updateRecurringRule(initialData.id, payload);
        if (error) {
          throw new Error(error);
        }
        toast.success('Regel erfolgreich aktualisiert');
      } else {
        const payload = { ...ruleData };
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        const { error } = await createRecurringRule(payload);
        if (error) {
          throw new Error(error);
        }
        toast.success('Regel erfolgreich erstellt');
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(`Fehler: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
```

#### `RecurringRulePanel.handleSubmit`

```194:233:src/features/clients/components/recurring-rule-panel.tsx
  const handleSubmit = async (values: RuleFormValues) => {
    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId,
        payers,
        billingTypes
      });

      if (existingRule) {
        const payload = { ...ruleData };
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        const { error } = await updateRecurringRule(existingRule.id, payload);
        if (error) {
          throw new Error(error);
        }
        toast.success('Regel erfolgreich aktualisiert');
      } else {
        const payload = { ...ruleData };
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        const { error } = await createRecurringRule(payload);
        if (error) {
          throw new Error(error);
        }
        toast.success('Regel erfolgreich erstellt');
      }

      onSuccess();
    } catch (error: any) {
      toast.error(`Fehler: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
```

#### `CreateRecurringRuleSheet.handleSubmit`

```182:217:src/features/recurring-rules/components/create-recurring-rule-sheet.tsx
  const handleSubmit = async (values: RuleFormValues) => {
    if (!selectedClient) return;

    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId: selectedClient.id,
        payers,
        billingTypes
      });

      if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
        ruleData.billing_variant_id = null;
      }

      const { error } = await createRecurringRule(ruleData);
      if (error) {
        throw new Error(error);
      }
      toast.success('Regel erfolgreich erstellt');
      onSuccess();
      onOpenChange(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
```

### 4.4 Does the form call the cron after save?

**No.** After save, handlers call `onSuccess()` (often `router.refresh()` on overview) and close the UI. **No** HTTP call to `/api/cron/generate-recurring-trips`, **no** Edge Function invoke. New trips appear only after the next scheduled cron run or a manual authenticated cron call.

---

## 5. Confirmation / destructive action patterns

### 5.1 Confirmation dialog component

**shadcn `AlertDialog`** — import path:

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
```

Primitive wrapper: `src/components/ui/alert-dialog.tsx`

### 5.2 Precedents for destructive / high-impact actions

| Feature | File | Pattern |
| --- | --- | --- |
| **Delete Regelfahrt rule** | `src/features/recurring-rules/components/delete-recurring-rule-dialog.tsx` | `AlertDialog` + optional “Zukünftige Fahrten löschen” `Switch` |
| **Cancel recurring trip** | `src/features/trips/components/recurring-trip-cancel-dialog.tsx` | `AlertDialog` with single / pair / series options + reason textarea |
| **Permanent trip delete** | `src/features/trips/components/trips-tables/cell-action.tsx` | `AlertDialog` before `tripsService.deleteTripsPermanently` |
| **Recurring trip edit scope** | `src/features/trips/trip-detail-sheet/dialogs/recurring-trip-edit-scope-dialog.tsx` | Scope confirmation before persisting edits |
| **Paired trip sync** | `src/features/trips/trip-detail-sheet/dialogs/paired-trip-sync-dialog.tsx` | Confirm sync to paired leg |

**Example — delete rule with future-trip toggle:**

```37:53:src/features/recurring-rules/components/delete-recurring-rule-dialog.tsx
  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await recurringRulesService.deleteRule(ruleId, deleteFutureTrips);
      toast.success(
        deleteFutureTrips
          ? 'Regel und zukünftige Fahrten gelöscht'
          : 'Regelfahrt gelöscht'
      );
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(`Fehler beim Löschen: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };
```

**No existing precedent** for confirming `end_date` shortening specifically.

---

## 6. Shared helpers

### 6.1 Date / time utilities

| File | Exported functions |
| --- | --- |
| `src/features/trips/lib/trip-business-date.ts` | `getTripsBusinessTimeZone`, `isYmdString`, `instantToYmdInBusinessTz`, `todayYmdInBusinessTz`, `getZonedDayBoundsIso`, `ymdToPickerDate` |
| `src/features/trips/lib/trip-time.ts` | `TripTimeError`, `buildScheduledAt`, `buildScheduledAtOrNull`, `parseScheduledAt`, `parseScheduledAtOrFallback` |
| `src/features/trips/lib/departure-schedule.ts` | `combineDepartureForTripInsert` (manual trip writes) |
| `src/features/trips/lib/duplicate-trip-schedule.ts` | Duplicate scheduling helpers |

### 6.2 Recurring-rule / trip-generation helpers

| File | Exported symbols |
| --- | --- |
| `src/features/clients/lib/build-recurring-rule-payload.ts` | `buildRecurringRulePayload` |
| `src/features/trips/lib/recurring-return-mode.ts` | `RecurringRuleReturnMode`, `RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME`, `recurringReturnModeFromRow` |
| `src/features/trips/api/recurring-rules.actions.ts` | `createRecurringRule`, `updateRecurringRule` |
| `src/features/trips/api/recurring-rules.service.ts` | `recurringRulesService` (`getClientRules`, `getRuleById`, `deleteRule`) |
| `src/features/trips/api/recurring-rules.server.ts` | `getAllRules`, `RecurringRuleWithClientEmbed` |
| `src/features/trips/api/recurring-exceptions.actions.ts` | `findPairedTrip`, `hasPairedLeg`, `cancelNonRecurringTrip`, `skipRecurringOccurrence`, `cancelRecurringSeries`, … |
| `src/lib/geocode-rule-addresses.ts` | `geocodeRuleAddresses`, `RuleCoordinates` |
| `src/lib/google-geocoding.ts` | `geocodeAddressLineToStructured` (cron + rule save) |
| `src/lib/google-directions.ts` | `resolveDrivingMetricsWithCache`, `COORD_PRECISION` (cron) |
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice` (cron materialization) |

**Not present:** `generateTripsForRule`, `deleteTripsAfterDate`, `invokeFunction`.

### 6.3 Central Edge Function invoke wrapper

**None.** Grep for `supabase.functions.invoke` and `functions.invoke` under `src/` returned **no matches**. Supabase Edge Functions are not used in this codebase for Regelfahrten.

### 6.4 Query keys

| File | Keys |
| --- | --- |
| `src/query/keys/recurring.ts` | `recurringKeys` (e.g. expiring rules banner) |

---

## Senior Recommendation

### On-demand cron trigger: Edge Function HTTP vs Supabase RPC

**Recommendation: keep and extend the existing Next.js API route pattern** (`POST` or `GET /api/cron/generate-recurring-trips`), invoked from a **server action** or **admin-only API route** after rule save — **not** a new Supabase Edge Function and **not** a generic Postgres RPC for generation logic.

| Approach | Assessment |
| --- | --- |
| **Next.js route (current)** | Already holds the full generation pipeline (RRule, geocoding, Directions, pricing engine, service role). Vercel Cron + `CRON_SECRET` are documented in `access-control.md`. Adding an admin-scoped server action that calls the same handler (or extracts shared `generateTripsForRules()` into a server-only module) avoids duplicating logic in Deno Edge. |
| **Supabase Edge Function** | No `supabase/functions/` folder; introducing one would duplicate ~700 lines of Node dependencies (`rrule`, price engine, Google APIs) unless heavily refactored. Poor fit unless the whole app moves cron off Vercel. |
| **Supabase RPC** | Suitable for **narrow, transactional DB work** (e.g. `delete_future_trips_for_rule_after_date(rule_id, ymd)`). **Unsuitable** as the main trip generator: geocoding, Directions, and pricing belong in application code, not PL/pgSQL. |

If on-demand generation is product-required after save, prefer: **server action → internal call to shared generator module** (same code path as cron), with `requireAdmin()` and optional `rule_id` filter to limit scope.

### Trip deletion on `end_date` shorten: server-side vs client-side

**Recommendation: server-side, in or immediately after `updateRecurringRule`**, with UI confirmation only for consent — **not** client-side Supabase deletes before update.

| Layer | Why |
| --- | --- |
| **Server action / RPC** | Ensures atomicity: rule update + trip cleanup in one trusted path; respects RLS vs service-role policy consistently; cannot be bypassed by a stale client. Reuse predicates from `deleteRule` (`requested_date >= today` Berlin, exclude completed/cancelled). |
| **DB trigger** | Possible but opaque; harder to surface counts to UI and to align with `ingestion_source` / leg pairing cleanup. |
| **Client-side delete before update** | Race-prone, duplicates logic already in `deleteRule`, and fails if the user closes the tab mid-flow. |

Mirror **`DeleteRecurringRuleDialog`**: when `newEndDate < oldEndDate`, show `AlertDialog` explaining how many future trips will be removed, then pass a flag to `updateRecurringRule` to run cleanup server-side.

### Risks and edge cases before new features

1. **Stale trips after `end_date` shorten** — documented gap; dispatchers may see Fahrten outside the rule window until manually handled.
2. **14-day horizon** — saving a new rule does not materialize trips until cron (or on-demand trigger); users may expect immediate Fahrten within the horizon.
3. **`cancelRecurringSeries` uses `format(new Date(), 'yyyy-MM-dd')` for timeless legs** — device-local date, not `todayYmdInBusinessTz()`; inconsistent with `deleteRule` near Berlin midnight.
4. **No `trips.rule_id` FK in generated types** — embeds and CASCADE behavior may be undefined; worth verifying live DB constraints before relying on FK cascades.
5. **Dedup does not use `scheduled_at`** — correct for timezone fixes, but rescheduled recurring trips can coexist with cron re-filling old slots (`docs/trip-reschedule-v1.md`).
6. **Return leg same calendar day only** — no `return_day_offset`; product requests for +N day returns need schema + cron changes (`regelfahrten-return-date-audit.md`).
7. **RLS on `recurring_rules`** — noted as missing in tracked migrations; production behavior may differ from local assumptions.
8. **Rules without `payer_id`** — cron skips with log only; silent no-op for trip generation until rule is re-saved.
9. **Cron auth** — `CRON_SECRET` in bearer header is powerful; any on-demand admin trigger must not expose the secret to the browser; use server-side proxy only.
10. **Partial cron failures** — per-rule `continue` on RRule parse errors / missing client; monitor `errors` count in JSON response.

---

## Files read (representative complete list)

- `src/app/api/cron/generate-recurring-trips/route.ts` (full)
- `vercel.json` (full)
- `src/features/clients/components/recurring-rule-sheet.tsx` (full)
- `src/features/clients/components/recurring-rule-panel.tsx` (full)
- `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx` (full)
- `src/features/clients/components/recurring-rule-form-body.tsx` (substantive)
- `src/features/clients/lib/build-recurring-rule-payload.ts` (full)
- `src/features/trips/api/recurring-rules.actions.ts` (full)
- `src/features/trips/api/recurring-rules.service.ts` (full)
- `src/features/trips/api/recurring-rules.server.ts` (full)
- `src/features/trips/api/recurring-exceptions.actions.ts` (full)
- `src/features/recurring-rules/components/delete-recurring-rule-dialog.tsx` (full)
- `src/features/trips/components/recurring-trip-cancel-dialog.tsx` (partial)
- `src/features/trips/lib/trip-business-date.ts` (full)
- `src/features/trips/lib/trip-time.ts` (full)
- `src/features/trips/lib/recurring-return-mode.ts` (full)
- `src/lib/geocode-rule-addresses.ts` (full)
- `src/types/database.types.ts` (`recurring_rules`, `trips`, `recurring_rule_exceptions`)
- `supabase/migrations/*recurring*` + `20260521120000_live_locations_cron_cleanup.sql`
- `docs/features/recurring-rules-overview.md`, `docs/access-control.md`, prior plan audits listed above
