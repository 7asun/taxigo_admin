---
name: recurring stations
overview: Implement payer-gated pickup/dropoff route station support for recurring rules, reusing existing billing behavior helpers and leaving existing generated trips untouched.
todos:
  - id: db-migration-types
    content: Add migration for payer flag and recurring-rule station columns, then regenerate database types
    status: completed
  - id: payer-flag
    content: Wire payer flag through payer admin types, services, reference data, cache invalidation, and immediate-save UI
    status: completed
  - id: billing-adapter
    content: Reuse shared billing helpers directly; only add a tiny compositional adapter if duplication would otherwise appear
    status: completed
  - id: rule-form-stations
    content: Add gated required station fields to all recurring-rule form entry points without passenger UI reuse
    status: completed
  - id: payload-generator
    content: Persist normalized station values and copy/swap them in recurring trip generation
    status: completed
  - id: tests-docs
    content: Add focused generator/form QA coverage and update recurring-rule product documentation
    status: completed
isProject: false
---

# Recurring Rule Stations Plan

## Approach
Add `recurring_rules_station_enabled` as a payer-level feature gate and `pickup_station` / `dropoff_station` as nullable recurring-rule route fields. The UI will remain visually unchanged when the payer flag is false; when true, the shared recurring rule form will render two required station fields near the corresponding addresses, persist trimmed values, and the generator will copy/swap them into generated trips.

Visibility is payer-gated only: `payers.recurring_rules_station_enabled` controls whether the station fields are shown and required. Family/variant billing behavior is still resolved through the shared trip helpers for consistency with return-mode and billing defaults, but it does not add a second station visibility gate.

The implementation will reuse existing billing infrastructure:

- Payer/reference data from [`src/features/trips/hooks/use-trip-form-data.ts`](src/features/trips/hooks/use-trip-form-data.ts), [`src/features/trips/api/trip-reference-data.ts`](src/features/trips/api/trip-reference-data.ts), and [`src/features/trips/types/trip-form-reference.types.ts`](src/features/trips/types/trip-form-reference.types.ts)
- Family/variant derivation from [`src/features/trips/hooks/use-billing-ui-for-payer.ts`](src/features/trips/hooks/use-billing-ui-for-payer.ts)
- Behavior source/normalization from [`src/features/trips/lib/resolve-billing-behavior-source.ts`](src/features/trips/lib/resolve-billing-behavior-source.ts) and [`src/features/trips/lib/normalize-billing-type-behavior-profile.ts`](src/features/trips/lib/normalize-billing-type-behavior-profile.ts)
- Existing KTS/no-invoice cascades from [`src/features/trips/lib/resolve-kts-default.ts`](src/features/trips/lib/resolve-kts-default.ts) and [`src/features/trips/lib/resolve-no-invoice-required.ts`](src/features/trips/lib/resolve-no-invoice-required.ts)

Hard mechanical reuse rule: recurring rules must derive selected payer, family/variant UI state, behavior source variant, and normalized behavior from the same shared helper stack used by trip creation. The only recurring-rule-specific logic should be rendering two route station fields and enforcing their requiredness when the payer gate is enabled.

Validation decision: recurring-rule station requiredness will use submit-time runtime validation, matching the one-off trip station pattern. Do not introduce a schema factory for this feature. The shared static `ruleFormSchema` may include optional station strings for typing, but the payer-context-dependent requirement must be enforced by one small reusable submit-validation helper used by all three recurring-rule shells.

## Implementation Steps
1. Add a Supabase migration under [`supabase/migrations`](supabase/migrations) for:
   - `recurring_rules.pickup_station text null`
   - `recurring_rules.dropoff_station text null`
   - `payers.recurring_rules_station_enabled boolean not null default false`
   - comments clarifying route/passenger station semantics and separation from `billing_calling_station` / `billing_betreuer`

   Deployment compatibility:
   - DB-first is safe: new nullable/defaulted columns do not change current behavior.
   - UI-before-DB is not safe: form submit and payer toggle updates can fail because Supabase columns are missing.
   - Hard deployment constraint: apply the migration before deploying app code that reads or writes the new columns.

2. Regenerate and review [`src/types/database.types.ts`](src/types/database.types.ts), ensuring only the expected `payers` and `recurring_rules` column additions are included.

3. Extend payer/reference data:
   - Add the flag to [`src/features/payers/types/payer.types.ts`](src/features/payers/types/payer.types.ts) and [`src/features/trips/types/trip-form-reference.types.ts`](src/features/trips/types/trip-form-reference.types.ts)
   - Select it in [`src/features/trips/api/trip-reference-data.ts`](src/features/trips/api/trip-reference-data.ts) and [`src/features/payers/api/payers.service.ts`](src/features/payers/api/payers.service.ts)
   - Add a single-column updater in [`src/features/payers/api/payers.service.ts`](src/features/payers/api/payers.service.ts)
   - Add an immediate-save switch in [`src/features/payers/components/payer-details-sheet.tsx`](src/features/payers/components/payer-details-sheet.tsx), invalidating both `PAYERS_QUERY_KEY` and [`referenceKeys.payers()`](src/query/keys/reference.ts)
   - The recurring-rule form must receive the new flag through the existing `useTripFormData()` → `fetchPayers()` → `PayerOption` pipeline. Do not add a separate payer-capability query.

4. Reuse shared billing derivation directly. First try direct calls to [`computeBillingUiDerived`](src/features/trips/hooks/use-billing-ui-for-payer.ts), [`resolveBillingBehaviorSourceVariant`](src/features/trips/lib/resolve-billing-behavior-source.ts), and [`normalizeBillingTypeBehavior`](src/features/trips/lib/normalize-billing-type-behavior-profile.ts). Do not create a new helper just to rename or slightly reshape shared logic.

   Only if direct use would force the same glue code into multiple recurring-rule files, add exactly one adapter at [`src/features/clients/lib/resolve-recurring-rule-billing-behavior.ts`](src/features/clients/lib/resolve-recurring-rule-billing-behavior.ts) with this fixed contract:
   - Inputs: `payers`, `billingTypes`, `payerId`, `billingVariantId`, `selectedFamilyId`
   - Outputs: `selectedPayer`, `billingUi`, `behaviorSourceVariant`, `billingBehavior`
   - Internals: compose the shared helpers above only; no local `Map`/filter family derivation beyond calling the shared helper.
   - Size rule: keep it tiny and purely compositional; if it starts containing decision logic, delete it and use the shared helpers directly at the call site.

5. Refactor [`src/features/clients/components/recurring-rule-billing-fields.tsx`](src/features/clients/components/recurring-rule-billing-fields.tsx) to consume shared family/variant derivation from the adapter/helper instead of local `Map`/filter duplication.

6. Extend [`src/features/clients/components/recurring-rule-form-body.tsx`](src/features/clients/components/recurring-rule-form-body.tsx):
   - Add `pickup_station` and `dropoff_station` to `RuleFormValues`, `ruleFormSchema`, and `getRuleFormDefaults()`
   - Resolve payer flag and billing behavior through the adapter
   - Render station inputs near pickup/dropoff addresses only when `selectedPayer.recurring_rules_station_enabled` is true
   - Require both fields when shown via submit-time runtime validation; do not use one-off trip passenger/group UI or a schema factory

7. Update recurring-rule submit paths:
   - Keep [`RecurringRuleSheet`](src/features/clients/components/recurring-rule-sheet.tsx), [`RecurringRulePanel`](src/features/clients/components/recurring-rule-panel.tsx), and [`CreateRecurringRuleSheet`](src/features/recurring-rules/components/create-recurring-rule-sheet.tsx) behavior aligned
   - Apply the same small validation helper before `buildRecurringRulePayload()` in all three shells with German error copy

8. Persist station fields in [`src/features/clients/lib/build-recurring-rule-payload.ts`](src/features/clients/lib/build-recurring-rule-payload.ts): trim strings and persist `null` for empty values. This preserves no-toggle behavior and avoids empty-string persistence.

9. Extend [`src/lib/recurring-trip-generator.ts`](src/lib/recurring-trip-generator.ts):
   - Outbound: `pickup_station = rule.pickup_station`, `dropoff_station = rule.dropoff_station`
   - Return: swap them
   - Do not add backfill/resync; existing dedupe means already-generated trips stay as-is

10. Add focused Bun tests under [`src/features/trips/lib/__tests__`](src/features/trips/lib/__tests__) for generator station behavior. Because no generator test currently exists, create a narrow test harness around `generateRecurringTrips()` with a stubbed Supabase client covering outbound-only, exact return swap, `time_tbd` return swap, and null station preservation.

11. Add form behavior coverage for the station-required submit path. If the current test setup can reasonably exercise React form submission, add at least one automated test proving that payer flag on + missing station blocks submit before payload creation. If component/form testing is not practical in this repo, document why and manually verify this checklist during final validation:
   - payer flag off hides both station fields
   - payer flag on shows both station fields
   - payer flag on requires both fields before submit
   - clearing/changing to a payer with the flag off hides the fields and persists `null`
   - all three entry points behave the same: [`RecurringRuleSheet`](src/features/clients/components/recurring-rule-sheet.tsx), [`RecurringRulePanel`](src/features/clients/components/recurring-rule-panel.tsx), [`CreateRecurringRuleSheet`](src/features/recurring-rules/components/create-recurring-rule-sheet.tsx)

12. Update product documentation:
   - [`docs/features/recurring-rules-overview.md`](docs/features/recurring-rules-overview.md)

   Do not update audit/planning documents as part of implementation unless the user explicitly asks for status tracking there.

## Verification
Run the requested gates as the implementation progresses:

- Migration/type gate: apply migration locally, then `bun run db:types`
- Type/build gates: `bun run build` after each major slice when practical
- Test gate: `bun test` after generator coverage is added
- Form QA gate: run or manually complete the station visibility/requiredness checklist before final response
- Final gate: `bun test` and `bun run build`

## Guardrails
- No reuse of one-off passenger/group UI for recurring rules
- No new duplicated family/variant derivation logic
- No backfill or resync of existing generated trips
- No changes to `billing_calling_station` / `billing_betreuer`
- Payers with `recurring_rules_station_enabled = false` remain visually and functionally unchanged
- Migration must ship before app code that reads/writes the new columns