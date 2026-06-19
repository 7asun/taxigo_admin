# Payer Station in recurring rules — audit

**Date:** 2026-06-18  
**Scope:** Read-only code/schema/docs audit. No code, schema, or data changes.

## Files read

Primary files:
- `src/features/clients/components/recurring-rule-sheet.tsx`
- `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx`
- `src/features/payers/components/payer-details-sheet.tsx`

Directly related implementation files:
- `src/features/clients/components/recurring-rule-panel.tsx`
- `src/features/clients/components/recurring-rule-form-body.tsx`
- `src/features/clients/components/recurring-rule-billing-fields.tsx`
- `src/features/clients/components/recurring-rules-list.tsx`
- `src/features/clients/lib/build-recurring-rule-payload.ts`
- `src/features/clients/lib/recurring-rule-submit-flow.ts`
- `src/features/trips/api/recurring-rules.service.ts`
- `src/features/trips/api/recurring-rules.actions.ts`
- `src/features/trips/api/recurring-rules.server.ts`
- `src/features/recurring-rules/components/recurring-rules-overview.tsx`
- `src/features/trips/hooks/use-trip-form-data.ts`
- `src/features/trips/hooks/use-trip-reference-queries.ts`
- `src/features/trips/api/trip-reference-data.ts`
- `src/features/trips/types/trip-form-reference.types.ts`
- `src/features/payers/hooks/use-payers.ts`
- `src/features/payers/types/payer.types.ts`
- `src/features/payers/api/payers.service.ts`
- `src/features/trips/components/create-trip/schema.ts`
- `src/features/trips/components/create-trip/create-trip-form.tsx`
- `src/features/trips/components/create-trip/trip-form-sections-context.tsx`
- `src/features/trips/components/create-trip/sections/payer-section.tsx`
- `src/features/trips/components/create-trip/sections/pickup-section.tsx`
- `src/features/trips/components/create-trip/sections/dropoff-section.tsx`
- `src/features/trips/components/trip-address-passenger/address-group-card.tsx`
- `src/features/trips/components/trip-address-passenger/add-passenger-inline.tsx`
- `src/features/trips/components/trip-address-passenger/passenger-badge.tsx`
- `src/features/trips/types.ts`
- `src/features/trips/lib/create-trip-draft.ts`
- `src/features/trips/hooks/use-create-trip-draft.ts`
- `src/features/trips/lib/normalize-billing-type-behavior-profile.ts`
- `src/lib/recurring-trip-generator.ts`
- `src/query/keys/reference.ts`
- `src/query/README.md`
- `src/types/database.types.ts` (relevant `payers`, `billing_types`, `billing_variants`, `recurring_rules`, `trips` sections)

Relevant docs and migrations:
- `docs/features/recurring-rules-overview.md`
- `docs/billing-families-variants.md`
- `docs/bulk-trip-upload.md`
- `docs/bulk-upload-behavior-rules.md`
- `docs/kts-architecture.md`
- `docs/panel-layout-system.md`
- `supabase/migrations/20260326120000_billing_families_and_variants.sql`
- `supabase/migrations/20260327120000_recurring_rules_billing.sql`
- `supabase/migrations/20260328120000_recurring_rules_return_mode.sql`
- `supabase/migrations/20260330120000_trips_billing_calling_station_betreuer.sql`
- `supabase/migrations/20260331100000_add_address_fields_to_payers.sql`
- `supabase/migrations/20260401190000_create_invoice_text_blocks.sql`
- `supabase/migrations/20260403120000_kts_catalog_and_trips.sql`
- `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql`
- `supabase/migrations/20260408120001_pdf_vorlagen.sql`
- `supabase/migrations/20260409170000_add_missing_rls.sql`
- `supabase/migrations/20260505120000_add-coords-to-recurring-rules.sql`
- `supabase/migrations/20260505180000_manual_km_overrides_foundation.sql`
- `supabase/migrations/20260514120000_reha_schein.sql`
- `supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql`

## 1. Single source of truth for recurring-rule form fields, validation, defaults, and payload

The current single source of truth is split across two tightly coupled modules:

- **Fields, validation, defaults, and edit-mode hydration:** `src/features/clients/components/recurring-rule-form-body.tsx`
  - `ruleFormSchema`
  - `RuleFormValues`
  - `getRuleFormDefaults`
  - rendered fields in `RecurringRuleFormBody`
  - invalid-submit UX via `handleRuleFormInvalid`
- **Submit payload shaping:** `src/features/clients/lib/build-recurring-rule-payload.ts`
  - maps `RuleFormValues` to `InsertRecurringRule`/`UpdateRecurringRule` shape
  - resolves KTS/no-invoice/fremdfirma cascade fields
  - transforms time strings (`HH:mm` → `HH:mm:00`, blank → `null`)

Shell components are intentionally thin wrappers around that shared form:

- `RecurringRuleSheet` — classic client detail overlay create/edit
- `RecurringRulePanel` — Miller-column create/edit
- `CreateRecurringRuleSheet` — `/dashboard/regelfahrten` two-step create flow

`RecurringRuleBillingFields` is also part of the recurring-rule form surface: it owns the payer/family/variant UI and catalog-driven KTS/no-invoice/fremdfirma controls for rules.

## 2. Does the recurring-rule model already support Station end-to-end?

No. The recurring-rule model does **not** currently support a Station field end-to-end.

There are two different Station-like concepts in the codebase:

1. **Route/passenger station:** `trips.pickup_station` and `trips.dropoff_station`.
   - Used by the one-off trip form passenger mode.
   - Stored per generated `trips` row.
   - Validated by billing family behavior flags `requirePickupStation` / `requireDropoffStation`.
2. **Billing metadata “Anrufstation”:** `trips.billing_calling_station`.
   - Optional free text shown when `behavior_profile.askCallingStationAndBetreuer` is true.
   - Explicitly documented as **not** route/passenger `pickup_station` / `dropoff_station`.

Recurring rules currently support neither as a persisted rule field:

- `RuleFormValues` has no station field.
- `ruleFormSchema` has no station validation.
- `getRuleFormDefaults` does not hydrate station values.
- `buildRecurringRulePayload` does not send station columns.
- `Database['recurring_rules']` has no `pickup_station`, `dropoff_station`, `billing_calling_station`, or `billing_betreuer` columns.
- `recurringRulesService.getRuleById()` selects `*`, but there is nothing to hydrate.
- `createRecurringRule`/`updateRecurringRule` would pass through typed payload fields, but the generated `InsertRecurringRule`/`UpdateRecurringRule` types do not include Station columns.
- `generateRecurringTrips` explicitly inserts generated trips with:
  - `pickup_station: null`
  - `dropoff_station: null`
  - no `billing_calling_station`
  - no `billing_betreuer`

So recurring rules can capture pickup/dropoff **addresses**, but not Station/additional route-stop text.

## 3. Where is payer configuration persisted, and safest place for “enable station in recurring rules”?

Payer-level configuration is persisted on `public.payers`.

Existing payer-level settings include:

- `payers.kts_default`
- `payers.no_invoice_required_default`
- `payers.accepts_self_payment`
- `payers.manual_km_enabled`
- `payers.reha_schein_enabled`
- `payers.revision_invoices_enabled`
- invoice/template fields such as `rechnungsempfaenger_id`, `pdf_vorlage_id`, `default_intro_block_id`, `default_outro_block_id`

The safest place for a new boolean setting like “enable Station in recurring rules” is a new column on `payers`, for example:

```sql
ALTER TABLE public.payers
  ADD COLUMN recurring_rules_station_enabled boolean NOT NULL DEFAULT false;
```

That matches the existing payer-level feature-gate pattern used by:

- `manual_km_enabled`
- `reha_schein_enabled`
- `revision_invoices_enabled`

This should be a payer setting, not a `billing_types.behavior_profile` setting, if the desired product behavior is “show Station in recurring-rule forms for this Kostenträger regardless of selected family/variant.” If the desired behavior is family-specific, then `behavior_profile` is the right level. The prompt wording says “enabled on a payer,” so `payers` is the cleaner fit.

## 4. Does `useTripFormData` already return enough payer metadata?

No. `useTripFormData` currently returns `payers` from `fetchPayers()`, whose query selects only:

```ts
id, name, kts_default, no_invoice_required_default, reha_schein_enabled
```

The corresponding `PayerOption` type exposes:

- `id`
- `name`
- `kts_default`
- `no_invoice_required_default`
- `reha_schein_enabled`

So conditional recurring-rule UI can already be driven by selected payer for KTS/no-invoice/Reha-like metadata, but it would need to be extended for a new station gate.

Minimal extension:

- Add `recurring_rules_station_enabled: boolean` to `PayerOption`.
- Extend `fetchPayers()` select to include `recurring_rules_station_enabled`.
- Invalidate both payer caches after saving the toggle:
  - `['payers']`
  - `referenceKeys.payers()`

## 5. Recurring-rule UI surfaces that need to change

To stay fully consistent, all recurring-rule create/edit surfaces need to flow through the same shared form and payload logic:

- `RecurringRuleFormBody`
  - Add the field UI once here.
  - Gate it from selected payer capability.
  - Add validation/hinting here or via a helper consumed here.
- `ruleFormSchema`
  - Add schema field(s).
- `RuleFormValues`
  - Derived from schema.
- `getRuleFormDefaults`
  - New-rule default.
  - Edit-mode hydration from `initialData`.
- `buildRecurringRulePayload`
  - Persist the field(s) into `recurring_rules`.
- `RecurringRuleSheet`
  - Should benefit automatically, because it renders `RecurringRuleFormBody` and calls `buildRecurringRulePayload`.
- `RecurringRulePanel`
  - Should benefit automatically for the same reason.
- `CreateRecurringRuleSheet`
  - Should benefit automatically for `/dashboard/regelfahrten` create flow, because it renders the same `RecurringRuleFormBody`.
- `RecurringRulesList` and `recurring-rules-overview` table/columns
  - Optional display only; not required for capture, but useful if admins need to review Station values on cards/table rows.

Potentially related but not required for capture:

- `recurring-rules.server.ts` / `recurring-rules.service.ts`
  - They use `select('*')`, so new columns are automatically fetched once DB types are regenerated.
- `generateRecurringTrips`
  - Required only if the Station value should affect generated trips immediately.

## 6. If Station is enabled on a payer, what validation/submit logic is required? What breaks if optional?

This depends on which Station concept the product wants.

### If the target is route/passenger Station (`pickup_station` / `dropoff_station`)

Minimal one-client recurring rules could support one or two simple rule-level fields:

- `pickup_station`
- `dropoff_station`

Validation options:

- If payer capability is enabled, show fields but keep optional.
- If payer capability is enabled and product requires Station, enforce non-empty values.
- If capability differentiates pickup vs dropoff, use two booleans or a mode instead of one boolean.

If Station remains optional:

- Nothing technically breaks.
- Generated trips can still be created with `pickup_station = null` / `dropoff_station = null`.
- But if the payer’s operational expectation is “Station required for recurring rules,” optional fields allow incomplete generated trips.
- This diverges from one-off trip passenger validation, where `requirePickupStation` / `requireDropoffStation` can block submit.
- Dispatchers may have to correct every generated trip manually.

### If the target is billing “Anrufstation” (`billing_calling_station`)

The naming and UX should be explicit. The existing docs repeatedly warn that `billing_calling_station` is billing metadata, not route Station. If this is what is requested, the UI label should likely be “Anrufstation” and not just “Station.”

Submit logic would mirror `CreateTripPayerSection`:

- Only show when payer/family capability says it applies.
- Trim blank to `null`.
- Persist to matching `recurring_rules` columns.
- Generator copies to generated `trips.billing_calling_station`.

What breaks if optional:

- Nothing at DB level.
- But invoice/detail consumers expecting the billing metadata may not see it on recurring-generated trips.

### Important product clarification

The current one-off trip form has both:

- passenger station fields (`pickup_station`, `dropoff_station`)
- billing metadata field (`billing_calling_station`)

The implementation should not introduce a generic “station” without deciding which of these it means.

## 7. Does recurring-rule generation already read/use Station?

No. `generateRecurringTrips` does not read Station from `recurring_rules` because no such rule columns exist.

It writes generated trips with route stations as null:

- outbound and return payloads set `pickup_station: null`
- outbound and return payloads set `dropoff_station: null`

It also does not copy `billing_calling_station` / `billing_betreuer`.

So a UI-only recurring-rule capture change would preserve data on the rule only if new rule columns are added, but generated trips would still not receive Station unless `generateRecurringTrips` is updated.

## 8. Existing immediate-save switch/toggle patterns in payer-details

Yes. `PayerDetailsSheet` has strong existing patterns to reuse.

Immediate-save switch examples:

- `handleManualKmEnabledChange`
  - calls `updatePayerManualKmEnabled`
  - invalidates `['payers']`
  - invalidates `referenceKeys.payers()`
  - shows `toast.success('Einstellung gespeichert')`
  - has local busy state
- `handleRehaScheinEnabledChange`
  - same pattern with `updatePayerRehaScheinEnabled`
  - has a short why comment
- `handleRevisionInvoicesEnabledChange`
  - same pattern with `updatePayerRevisionInvoicesEnabled`
  - includes a why comment explaining the payer-level gate

The new setting should reuse this pattern:

- local busy state, e.g. `recurringRuleStationToggleBusy`
- single-purpose service function, e.g. `updatePayerRecurringRulesStationEnabled`
- invalidate `['payers']` and `referenceKeys.payers()`
- toast success/error
- display current value from `displayPayer`, which merges `payer` prop with the `usePayers()` cache

## 9. Exact files for minimal safe implementation and extra regression attention

### Minimal safe file set

Schema/types:

- New migration under `supabase/migrations/`:
  - add `payers.recurring_rules_station_enabled`
  - add recurring rule Station columns if generation/capture should persist them, likely one of:
    - `recurring_rules.pickup_station`, `recurring_rules.dropoff_station`
    - or `recurring_rules.billing_calling_station`, `recurring_rules.billing_betreuer`
- Regenerate `src/types/database.types.ts`.

Payer setting:

- `src/features/payers/types/payer.types.ts`
  - add field to `Payer`.
- `src/features/trips/types/trip-form-reference.types.ts`
  - add field to `PayerOption`.
- `src/features/payers/api/payers.service.ts`
  - select new column in `getPayers`.
  - add single-column updater.
- `src/features/payers/hooks/use-payers.ts`
  - no major change if using standalone updater; ensure mutation/invalidation if routed through `updatePayer`.
- `src/features/payers/components/payer-details-sheet.tsx`
  - add switch + handler.
- `src/features/trips/api/trip-reference-data.ts`
  - select new column in `fetchPayers`.

Recurring-rule form:

- `src/features/clients/components/recurring-rule-form-body.tsx`
  - schema/defaults/hydration/rendered field(s).
- `src/features/clients/lib/build-recurring-rule-payload.ts`
  - map field(s) to DB columns.
- Optional new helper:
  - `src/features/recurring-rules/lib/payer-recurring-rule-capabilities.ts`

Generation:

- `src/lib/recurring-trip-generator.ts`
  - copy rule Station columns to generated trips if the feature is meant to affect generated rows.

Docs/tests:

- `docs/features/recurring-rules-overview.md`
- `docs/billing-families-variants.md` if behavior/capability semantics intersect with family behavior.
- focused tests for helper/payload/generator if existing test setup permits.

### Risky/shared files needing extra regression attention

- `recurring-rule-form-body.tsx`
  - Shared by all rule create/edit surfaces. A validation mistake breaks all recurring-rule saves.
- `build-recurring-rule-payload.ts`
  - Shared submit payload. A wrong null/trim decision affects DB rows and generation.
- `useTripFormData` / `fetchPayers` / `PayerOption`
  - Shared by create trip, recurring rules, filters, and pickers. Adding fields is safe, but changing shape or stale-time behavior can cause broad UI drift.
- `payers.service.ts` / `PayerDetailsSheet`
  - Existing payer update paths are partially split between broad `updatePayer` and single-column feature updaters. A new setting should not accidentally drop other payer fields.
- `generateRecurringTrips`
  - Server-only, cron path, pricing/geocoding-heavy. Any change here affects nightly and on-demand materialisation.
- `database.types.ts`
  - Currently appears partially out of sync with migrations/code (for example app code references payer fields not visible in the shown generated `payers` type section). Type regeneration should be handled carefully and reviewed for broad diffs.

## 10. Should we introduce a helper/module for payer-driven recurring-rule capabilities?

Yes, if this feature is implemented.

Recommended new module:

`src/features/recurring-rules/lib/payer-recurring-rule-capabilities.ts`

It should own only pure, UI-safe decisions such as:

- `getRecurringRuleCapabilitiesForPayer(payer)`
- `canUseStationOnRecurringRules(payer)`
- `shouldRequireRecurringRulePickupStation(payer)` if product chooses required semantics
- `shouldRequireRecurringRuleDropoffStation(payer)` if needed
- normalization for missing old payer rows (`false` defaults)

It should **not** own:

- DB mutations
- React Query invalidation
- Supabase queries
- payload building
- trip generation

Reason: payer-driven gates already exist in multiple places (Reha, KTS/no-invoice cascade, manual KM, invoice revision). A helper prevents the same `payers.find(...)?....` conditional from being duplicated across `RecurringRuleFormBody`, parent shells, and future overview/table display.

## 11. DB/schema changes, generated types, migration steps

At minimum, if the feature is truly payer-gated:

1. Add a payer setting column:

```sql
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS recurring_rules_station_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payers.recurring_rules_station_enabled IS
  'When true, recurring-rule forms show Station fields for this payer. False by default.';
```

2. Decide and add recurring-rule storage columns.

For route/passenger station:

```sql
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS pickup_station text,
  ADD COLUMN IF NOT EXISTS dropoff_station text;
```

For billing metadata “Anrufstation”:

```sql
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS billing_calling_station text,
  ADD COLUMN IF NOT EXISTS billing_betreuer text;
```

3. Regenerate `src/types/database.types.ts`.

4. Update TypeScript domain types:

- `Payer`
- `PayerOption`
- any recurring-rule wrapper types if not fully derived from `Database`.

5. Update selectors:

- `PayersService.getPayers()`
- `fetchPayers()`

6. Add service updater for the payer toggle:

- `updatePayerRecurringRulesStationEnabled(payerId, enabled, supabase)`

7. If Station should materialise onto trips:

- Update `generateRecurringTrips` to copy rule station columns.

RLS impact:

- Payer and recurring-rule writes are already protected by table RLS/admin APIs. Adding simple nullable columns does not require a new policy, but the migration should not weaken existing policies.

Generated types warning:

- The current checked `database.types.ts` section for `payers` appears stale relative to migrations/app code (for example, code uses `pdf_vorlage_id`, while the shown `payers` type section lacks it). A type regeneration may produce unrelated changes; review those carefully and avoid mixing broad generated type churn with feature logic unless required.

## 12. Senior recommendation

Recommended implementation shape: **small shared capability helper + explicit schema columns**, not inline conditions scattered across components.

Why:

- The recurring-rule form is shared across three surfaces. Inline conditions in each parent would drift.
- `useTripFormData` already gives a payer list to the shared form; extending that payer metadata plus using a pure helper is low-complexity and consistent with existing KTS/Reha patterns.
- Payer-level feature gates already exist and are immediate-save toggles in `PayerDetailsSheet`.
- Station has ambiguous meaning in the app. A helper provides a naming boundary and prevents mixing “route Station” with “Anrufstation.”

Implementation should happen in two phases only if product scope is uncertain:

1. **Small fix now:** payer toggle + recurring-rule capture + payload/hydration, with explicit naming and docs.
2. **Generation follow-up only if required:** copy the field to generated trips and decide whether existing future trips should be backfilled/resynced.

If the intent is to affect generated trip rows immediately, include generation in the same implementation. Otherwise admins will capture Station on the rule but every generated trip will still have `pickup_station = null` / `dropoff_station = null`, which is likely surprising.

## Difficulty rating

**Recommended difficulty: 5 / 10** for a minimal, safe implementation that adds:

- payer toggle
- reference metadata extension
- recurring-rule form field(s)
- payload/default/hydration
- DB columns/types
- generator copy

It becomes **6.5 / 10** if the feature must also resync already-generated future trips or interact with exception rows.

## Top 3 technical risks

1. **Station semantic confusion**
   - The app has both passenger route stations (`pickup_station` / `dropoff_station`) and billing “Anrufstation” (`billing_calling_station`).
   - Implementing a generic “Station” without deciding which one is meant risks wrong DB columns and misleading UI labels.

2. **Shared recurring form regression**
   - `RecurringRuleFormBody`, `ruleFormSchema`, `getRuleFormDefaults`, and `buildRecurringRulePayload` are shared by classic Sheet, column Panel, and overview create Sheet.
   - A schema/default mismatch can block all recurring-rule submissions.

3. **Generation/capture mismatch**
   - If the rule captures Station but `generateRecurringTrips` is not updated, generated trips will continue to store null Station fields.
   - This creates an invisible data-loss path from rule to trip.

## Recommended file structure

New helper:

```text
src/features/recurring-rules/lib/payer-recurring-rule-capabilities.ts
```

Suggested contents:

```ts
export interface RecurringRulePayerCapabilities {
  stationEnabled: boolean;
}

export function getRecurringRulePayerCapabilities(
  payer: { recurring_rules_station_enabled?: boolean | null } | null | undefined
): RecurringRulePayerCapabilities {
  return {
    stationEnabled: payer?.recurring_rules_station_enabled === true
  };
}
```

Suggested implementation file map:

```text
supabase/migrations/<new>_payer_recurring_rule_station.sql
src/types/database.types.ts
src/features/payers/types/payer.types.ts
src/features/trips/types/trip-form-reference.types.ts
src/features/trips/api/trip-reference-data.ts
src/features/payers/api/payers.service.ts
src/features/payers/components/payer-details-sheet.tsx
src/features/recurring-rules/lib/payer-recurring-rule-capabilities.ts
src/features/clients/components/recurring-rule-form-body.tsx
src/features/clients/lib/build-recurring-rule-payload.ts
src/lib/recurring-trip-generator.ts
docs/features/recurring-rules-overview.md
docs/billing-families-variants.md
```

## Final recommendation: small fix now or broader cleanup?

Implement as a **small fix now**, but only after the product names the exact Station concept:

- If this means **route Station**, add `pickup_station` / `dropoff_station` to `recurring_rules` and copy to generated `trips`.
- If this means **Anrufstation**, add `billing_calling_station` / `billing_betreuer` to `recurring_rules` and copy to generated `trips`.

Do **not** wait for a broad payer-capabilities cleanup. The current code already has enough patterns to implement this safely:

- payer-level boolean toggles
- two payer query keys
- shared recurring form body
- payload builder
- recurring generator copy pattern

However, introduce the small capability helper now so this does not become the next duplicated payer-gate condition. A broader cleanup can later consolidate Reha/manual-KM/revision/station under a larger payer capability vocabulary if needed.
