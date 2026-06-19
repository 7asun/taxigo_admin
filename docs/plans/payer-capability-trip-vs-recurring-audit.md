# Payer Capability: Trip vs Recurring Rules Audit

Status: Audit only

Scope: one-off trip payer/billing-family capability behavior and how it should be reused for recurring-rule station fields.

## Executive Summary

The one-off trip form uses a mixed capability model:

- Payer-row flags/defaults come from `payers` (`kts_default`, `no_invoice_required_default`, `reha_schein_enabled`) via `fetchPayers()` (`src/features/trips/api/trip-reference-data.ts:28-39`).
- Billing-family behavior comes from `billing_types.behavior_profile`, flattened onto each `BillingVariantOption` by `fetchBillingVariantsForPayer()` (`src/features/trips/api/trip-reference-data.ts:45-110`).
- Variant-level defaults come from `billing_variants.kts_default` and `billing_variants.no_invoice_required_default` (`src/features/trips/api/trip-reference-data.ts:58-65`, `src/types/database.types.ts:138-188`).

For station fields specifically, `pickup_station` / `dropoff_station` are controlled by billing-family behavior properties `requirePickupStation` and `requireDropoffStation`, not by the payer row or billing variant. They are always rendered in passenger mode, and become submit-blocking only when those flags are true (`src/features/trips/components/create-trip/create-trip-form.tsx:1114-1142`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:104-113`).

## 1. Complete Payer/Billing-Driven Field List

1. `billing_variant_id` / Unterart selector
   - Config: existence/count of `billing_types` families and `billing_variants` for selected payer.
   - Level: DB rows under selected `payers.id`, not a boolean property.
   - Render: `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:57-107`, `src/features/trips/components/create-trip/sections/payer-section.tsx:169-237`).
   - Required: manual submit guard if variants exist and no variant selected (`src/features/trips/components/create-trip/create-trip-form.tsx:1161-1173`).

2. Abrechnungsfamilie selector
   - Config: more than one distinct `billing_type_id` in flattened variants.
   - Level: `billing_types` rows for selected payer.
   - Render: `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:57-75`, `src/features/trips/components/create-trip/sections/payer-section.tsx:169-190`).

3. `kts_document_applies`
   - Config: default cascade `billing_variants.kts_default` -> `billing_types.behavior_profile.kts_default` -> `payers.kts_default` -> false.
   - Level: variant, family, payer.
   - Resolver: `resolveKtsDefault()` (`src/features/trips/lib/resolve-kts-default.ts:1-85`).
   - Render: shown once a payer is selected in `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:240-276`).
   - Required: optional switch; defaults are auto-applied unless user locks/manual-touches the field (`src/features/trips/components/create-trip/create-trip-form.tsx:404-460`).

4. `reha_schein`
   - Config: `payers.reha_schein_enabled`.
   - Level: payer row.
   - Render: `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:278-300`).
   - Persistence guard: saved only when selected payer has `reha_schein_enabled`; otherwise forced false (`src/features/trips/components/create-trip/create-trip-form.tsx:1311-1320`).

5. `no_invoice_required`
   - Config: default cascade `billing_variants.no_invoice_required_default` -> `billing_types.behavior_profile.no_invoice_required_default` -> `payers.no_invoice_required_default` -> false.
   - Level: variant, family, payer.
   - Resolver: `resolveNoInvoiceRequiredDefault()` (`src/features/trips/lib/resolve-no-invoice-required.ts:1-50`).
   - Render: only when catalog cascade resolves true in `CreateTripPayerSection` (`src/features/trips/components/create-trip/create-trip-form.tsx:511-525`, `src/features/trips/components/create-trip/sections/payer-section.tsx:302-331`).
   - Required: optional/manual switch; not Zod-required.

6. `billing_calling_station` / Anrufstation
   - Config: `billing_types.behavior_profile.askCallingStationAndBetreuer` or snake-case equivalent.
   - Level: billing family (`billing_types.behavior_profile`).
   - Render: `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:345-365`).
   - Required: optional text field.
   - Persistence: written only when behavior asks for it (`src/features/trips/components/create-trip/create-trip-form.tsx:1266-1272`, `src/features/trips/components/create-trip/create-trip-form.tsx:1323-1328`).

7. `billing_betreuer`
   - Config: same as `billing_calling_station`.
   - Level: billing family.
   - Render: `CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx:366-385`).
   - Required: optional text field.

8. Passenger mode vs anonymous mode
   - Config: `billing_types.behavior_profile.requirePassenger`.
   - Level: billing family.
   - Render: `CreateTripPickupSection` and `CreateTripDropoffSection` switch between passenger cards and anonymous address-only mode (`src/features/trips/components/create-trip/sections/pickup-section.tsx:38-40`, `src/features/trips/components/create-trip/sections/pickup-section.tsx:62-233`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:37-39`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:64-249`).
   - Required: passengers and dropoff assignment are submit-blocking only when `requirePassenger` is true (`src/features/trips/components/create-trip/create-trip-form.tsx:1082-1143`).

9. `pickup_station`
   - Config: `billing_types.behavior_profile.requirePickupStation`.
   - Level: billing family.
   - Render: `PassengerBadge` inside pickup `AddressGroupCard` (`src/features/trips/components/create-trip/sections/pickup-section.tsx:178-218`, `src/features/trips/components/trip-address-passenger/address-group-card.tsx:152-180`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:104-113`).
   - Required: only in passenger mode and only when `requirePickupStation` is true (`src/features/trips/components/create-trip/create-trip-form.tsx:1114-1128`).

10. `dropoff_station`
   - Config: `billing_types.behavior_profile.requireDropoffStation`.
   - Level: billing family.
   - Render: `PassengerBadge` inside dropoff `AddressGroupCard` (`src/features/trips/components/create-trip/sections/dropoff-section.tsx:196-234`, `src/features/trips/components/trip-address-passenger/address-group-card.tsx:212-236`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:104-113`).
   - Required: only in passenger mode and only when `requireDropoffStation` is true (`src/features/trips/components/create-trip/create-trip-form.tsx:1129-1142`).

11. Pickup address lock/default/hint
   - Config: `lockPickup`, `defaultPickup*` fields in `billing_types.behavior_profile`.
   - Level: billing family.
   - Render/effect: default applied in `CreateTripForm`; lock and hint used in pickup section (`src/features/trips/components/create-trip/create-trip-form.tsx:604-655`, `src/features/trips/components/create-trip/create-trip-form.tsx:723-724`, `src/features/trips/components/create-trip/sections/pickup-section.tsx:38-40`, `src/features/trips/components/create-trip/sections/pickup-section.tsx:68-70`, `src/features/trips/components/create-trip/sections/pickup-section.tsx:100-120`).

12. Dropoff address lock/default/hint
   - Config: `lockDropoff`, `defaultDropoff*` fields in `billing_types.behavior_profile`.
   - Level: billing family.
   - Render/effect: default applied in `CreateTripForm`; lock and hint used in dropoff section (`src/features/trips/components/create-trip/create-trip-form.tsx:657-688`, `src/features/trips/components/create-trip/create-trip-form.tsx:723-724`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:37-39`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:163-165`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:94-149`).

13. `return_mode`, `return_date`, `return_time`
   - Config: `returnPolicy` and `lockReturnMode` in `billing_types.behavior_profile`.
   - Level: billing family.
   - Render/effect: return mode auto-selected from behavior and locked/hidden when needed (`src/features/trips/components/create-trip/create-trip-form.tsx:690-698`, `src/features/trips/components/create-trip/create-trip-form.tsx:725-728`, `src/features/trips/components/create-trip/sections/schedule-section.tsx:142-150`, `src/features/trips/components/create-trip/sections/schedule-section.tsx:214-331`).
   - Required: exact return date/time are Zod-required only when `return_mode === 'exact'` (`src/features/trips/components/create-trip/schema.ts:60-76`).

14. `prefillDropoffFromPickup`
   - Config: `billing_types.behavior_profile.prefillDropoffFromPickup`.
   - Level: billing family.
   - Effect: copies pickup edits into first dropoff group (`src/features/trips/components/create-trip/create-trip-form.tsx:880-901`).

## 2. Where The Logic Lives

The pattern is intentionally not pure Zod.

- Static Zod schema: base scalar validation and exact-return date/time validation live in `tripFormSchema` (`src/features/trips/components/create-trip/schema.ts:15-91`).
- Data fetch: payer and billing capability data comes from `useTripFormData()` (`src/features/trips/hooks/use-trip-form-data.ts:40-142`).
- Behavior source selection: `resolveBillingBehaviorSourceVariant()` picks the selected variant, or the first variant in the effective family before a variant is selected (`src/features/trips/lib/resolve-billing-behavior-source.ts:1-31`).
- Behavior normalization: `normalizeBillingTypeBehavior()` converts JSON to booleans (`src/features/trips/lib/normalize-billing-type-behavior-profile.ts:100-155`).
- Render-time visibility: section components read context and branch in JSX (`src/features/trips/components/create-trip/trip-form-sections-context.tsx:32-119`).
- Runtime custom validation: passenger/station requirements are checked manually in `handleSubmit()` before insertion (`src/features/trips/components/create-trip/create-trip-form.tsx:1077-1159`).

Exact station-required pattern:

```tsx
if (requirePassenger) {
  const passengerStationErrors: Record<string, { pickup?: boolean; dropoff?: boolean }> = {};
  if (billingBehavior.requirePickupStation) { ... }
  if (billingBehavior.requireDropoffStation) { ... }
  if (Object.keys(passengerStationErrors).length > 0) {
    errors.passengerStationErrors = passengerStationErrors;
  }
}
```

Source: `src/features/trips/components/create-trip/create-trip-form.tsx:1107-1142`.

## 3. Data Flow From DB To Render

1. DB shape:
   - `payers` contains payer-level defaults/gates (`kts_default`, `no_invoice_required_default`, `reha_schein_enabled`) (`src/types/database.types.ts:761-821`).
   - `billing_types` contains `behavior_profile`, `color`, `name`, and `payer_id` (`src/types/database.types.ts:89-137`).
   - `billing_variants` contains leaf rows and variant defaults (`kts_default`, `no_invoice_required_default`) (`src/types/database.types.ts:138-188`).

2. Fetchers:
   - `fetchPayers()` selects payer flags used by the trip form (`src/features/trips/api/trip-reference-data.ts:28-39`).
   - `fetchBillingVariantsForPayer(payerId)` selects `billing_types.behavior_profile` and nested `billing_variants`, then flattens each variant with parent family metadata (`src/features/trips/api/trip-reference-data.ts:45-110`).

3. Query hooks:
   - `usePayersQuery()` and `useBillingVariantsForPayerQuery(payerId)` wrap the fetchers with TanStack Query and `referenceKeys` (`src/features/trips/hooks/use-trip-reference-queries.ts:29-51`).

4. Form hook:
   - `useTripFormData(watchedPayerId)` returns `payers`, flattened `billingTypes`/`billingVariants`, drivers, and client search helpers (`src/features/trips/hooks/use-trip-form-data.ts:40-142`).

5. Create form:
   - `CreateTripForm` watches `payer_id` and `billing_variant_id`, calls `useTripFormData()`, derives the effective billing family, resolves a behavior source variant, normalizes `billingBehavior`, and passes everything through `TripFormSectionsProvider` (`src/features/trips/components/create-trip/create-trip-form.tsx:285-318`, `src/features/trips/components/create-trip/create-trip-form.tsx:532-555`, `src/features/trips/components/create-trip/create-trip-form.tsx:716-729`, `src/features/trips/components/create-trip/create-trip-form.tsx:1701-1754`).

6. Section components:
   - `CreateTripPayerSection`, `CreateTripPickupSection`, `CreateTripDropoffSection`, and `CreateTripScheduleSection` read `useTripFormSections()` and render based on the context (`src/features/trips/components/create-trip/sections/payer-section.tsx:28-47`, `src/features/trips/components/create-trip/sections/pickup-section.tsx:17-36`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:17-35`, `src/features/trips/components/create-trip/sections/schedule-section.tsx:142-150`).

## 4. Single Source Of Truth?

Partial yes, but not complete.

Single-source pieces:

- Behavior JSON parsing/normalization: `normalizeBillingTypeBehavior()` and `parseBehaviorProfileRaw()` are the best single source for interpreting `billing_types.behavior_profile` (`src/features/trips/lib/normalize-billing-type-behavior-profile.ts:1-155`).
- Behavior source resolution before variant selection: `resolveBillingBehaviorSourceVariant()` (`src/features/trips/lib/resolve-billing-behavior-source.ts:1-31`).
- KTS default precedence: `resolveKtsDefault()` (`src/features/trips/lib/resolve-kts-default.ts:1-85`).
- No-invoice default precedence: `resolveNoInvoiceRequiredDefault()` (`src/features/trips/lib/resolve-no-invoice-required.ts:1-50`).
- Billing-family/variant UI derivation exists in `use-billing-ui-for-payer.ts` (`src/features/trips/hooks/use-billing-ui-for-payer.ts:16-101`).

Fragmentation:

- `CreateTripPayerSection` duplicates family/variant UI derivation instead of using `useBillingUiForPayer`; it has a TODO to replace that duplication (`src/features/trips/components/create-trip/sections/payer-section.tsx:28-30`, `src/features/trips/components/create-trip/sections/payer-section.tsx:57-107`).
- `RecurringRuleBillingFields` duplicates the same family/variant derivation again (`src/features/clients/components/recurring-rule-billing-fields.tsx:146-201`).
- `RecurringRuleFormBody` resolves behavior only from selected `billing_variant_id`, not from an effective family before variant selection (`src/features/clients/components/recurring-rule-form-body.tsx:299-310`).

## 5. Station Handling In One-Off Trips

`pickup_station` and `dropoff_station` live on `PassengerEntry` (`src/features/trips/types.ts:1-12`).

Rendering:

- Pickup mode passes `stationErrorForPassenger(uid)` for pickup errors into `AddressGroupCard` (`src/features/trips/components/create-trip/sections/pickup-section.tsx:178-218`).
- Dropoff mode does the same for dropoff errors (`src/features/trips/components/create-trip/sections/dropoff-section.tsx:196-234`).
- `AddressGroupCard` chooses `stationField` by mode and passes it into `PassengerBadge` (`src/features/trips/components/trip-address-passenger/address-group-card.tsx:101-104`, `src/features/trips/components/trip-address-passenger/address-group-card.tsx:152-180`, `src/features/trips/components/trip-address-passenger/address-group-card.tsx:212-236`).
- `PassengerBadge` always renders a station input for the current side and highlights it when `stationInputError` is true (`src/features/trips/components/trip-address-passenger/passenger-badge.tsx:37-40`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:104-113`).

Required behavior:

- `requirePickupStation` and `requireDropoffStation` are normalized from `billing_types.behavior_profile` (`src/features/trips/lib/normalize-billing-type-behavior-profile.ts:137-146`).
- The fields are required only when `requirePassenger` is true and the corresponding station flag is true (`src/features/trips/components/create-trip/create-trip-form.tsx:1107-1142`).
- In anonymous mode, stations are not collected and inserts explicitly store null (`src/features/trips/components/create-trip/create-trip-form.tsx:1371-1416`, `src/features/trips/components/create-trip/create-trip-form.tsx:1438-1491`).

Persistence:

- Passenger outbound trips write `p.pickup_station` and `p.dropoff_station` (`src/features/trips/components/create-trip/create-trip-form.tsx:1527-1577`).
- Passenger return trips swap them (`src/features/trips/components/create-trip/create-trip-form.tsx:1614-1671`).

## 6. Zod Adaptation Pattern

The trip form uses a static schema, not a schema factory. Capability changes do not rebuild Zod.

- Static schema: `tripFormSchema` (`src/features/trips/components/create-trip/schema.ts:15-91`).
- Static `superRefine`: only validates exact return date/time and KTS error-description consistency (`src/features/trips/components/create-trip/schema.ts:60-89`).
- Station-required validation is outside Zod in `CreateTripForm.handleSubmit()` (`src/features/trips/components/create-trip/create-trip-form.tsx:1077-1159`).

So for stations, the exact pattern is runtime submit validation plus a parallel `formErrors.passengerStationErrors` object passed down to station inputs (`src/features/trips/components/create-trip/trip-form-sections-context.tsx:20-30`, `src/features/trips/components/create-trip/trip-form-sections-context.tsx:57-59`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:16-17`).

## 7. Directly Reusable Pieces For Recurring Rules

Reusable without modification:

- `useTripFormData()` for payer and billing variant data (`src/features/trips/hooks/use-trip-form-data.ts:40-142`).
- `PayerOption` and `BillingVariantOption` types (`src/features/trips/types/trip-form-reference.types.ts:6-35`).
- `normalizeBillingTypeBehavior()` and `parseBehaviorProfileRaw()` (`src/features/trips/lib/normalize-billing-type-behavior-profile.ts:63-155`).
- `resolveBillingBehaviorSourceVariant()` for family-first behavior resolution (`src/features/trips/lib/resolve-billing-behavior-source.ts:1-31`).
- `computeBillingFamilies()` / `computeBillingUiDerived()` from `use-billing-ui-for-payer.ts` for family/variant dropdown derivation (`src/features/trips/hooks/use-billing-ui-for-payer.ts:16-80`).
- `resolveKtsDefault()` and `resolveNoInvoiceRequiredDefault()` for existing recurring billing defaults (`src/features/trips/lib/resolve-kts-default.ts:66-85`, `src/features/trips/lib/resolve-no-invoice-required.ts:32-50`).
- `BillingProfilePickupAddressHint` / `BillingProfileDropoffAddressHint` if recurring rules implement family default address hints (`src/features/trips/components/create-trip/billing-profile-address-hints.tsx:8-26`).

Not reusable without modification:

- `TripFormSectionsProvider` / `useTripFormSections()` are tightly typed around one-off trip state, passengers, groups, drivers, dates, and callbacks (`src/features/trips/components/create-trip/trip-form-sections-context.tsx:32-119`).
- `AddressGroupCard` / `PassengerBadge` are built around per-passenger multi-address trip creation (`src/features/trips/components/trip-address-passenger/address-group-card.tsx:23-75`, `src/features/trips/components/trip-address-passenger/passenger-badge.tsx:13-24`).
- `CreateTripPickupSection` and `CreateTripDropoffSection` depend on one-off trip context and passenger/address group state (`src/features/trips/components/create-trip/sections/pickup-section.tsx:17-36`, `src/features/trips/components/create-trip/sections/dropoff-section.tsx:17-35`).

## 8. Changes And Reuse For Recurring Station Fields

What should be reused:

- Use the same `useTripFormData(watchedPayerId)` data source already used by recurring rule shells/components.
- Use `normalizeBillingTypeBehavior()` for `requirePickupStation` / `requireDropoffStation`.
- Use `resolveBillingBehaviorSourceVariant()` plus family UI derivation so recurring rules can know behavior when the family is selected, not only after variant selection.
- Use the same empty-string-to-null normalization style already used by `buildRecurringRulePayload()` for optional fields.

What needs recurring-specific code:

- Add `pickup_station` / `dropoff_station` fields to `RuleFormValues`, `ruleFormSchema`, and `getRuleFormDefaults()` in `RecurringRuleFormBody`.
- Render station inputs near `pickup_address` and `dropoff_address` in `RecurringRuleFormBody`, because recurring rules are one-client, one-route templates rather than multi-passenger trip forms.
- Validate required station fields in recurring schema or submit flow using the normalized billing behavior. Since recurring rules use simple scalar fields, Zod `superRefine` can work if behavior is passed through a schema factory, but the current codebase pattern would be simpler as component/submit-time validation unless the form is refactored.
- Persist the fields through `buildRecurringRulePayload()` and into `recurring_rules`, then map them in `generateRecurringTrips()` as described in the generator audit.

## 9. Is Capability Data Already Available In Recurring Rule Shells?

Yes, mostly.

- `RecurringRuleSheet` watches `payer_id` and calls `useTripFormData(payerWatch)`, returning `payers`, `billingTypes`, and `searchClientsById` (`src/features/clients/components/recurring-rule-sheet.tsx:90-99`).
- `RecurringRulePanel` does the same (`src/features/clients/components/recurring-rule-panel.tsx:106-114`).
- `CreateRecurringRuleSheet` does the same for overview create flow (`src/features/recurring-rules/components/create-recurring-rule-sheet.tsx:90-98`).
- `RecurringRuleFormBody` also calls `useTripFormData(watchedPayerId)` internally for behavior (`src/features/clients/components/recurring-rule-form-body.tsx:299-310`).
- `RecurringRuleBillingFields` calls `useTripFormData(watchedPayerId)` again for payer/billing rendering and defaults (`src/features/clients/components/recurring-rule-billing-fields.tsx:43-46`).

No separate fetch is needed for existing behavior flags. If a new payer-row station gate is added later, it must be added to `fetchPayers()` and `PayerOption`; then it would also arrive through `useTripFormData()`.

## 10. Inconsistencies To Resolve Before Building

1. Create-trip uses family-first behavior resolution; recurring rules use selected-variant-only behavior resolution.
   - One-off: `resolveBillingBehaviorSourceVariant()` with `effectiveFamilyId` (`src/features/trips/components/create-trip/create-trip-form.tsx:547-555`).
   - Recurring: `billingTypes.find((b) => b.id === watchedBillingVariantId)` only (`src/features/clients/components/recurring-rule-form-body.tsx:306-310`).

2. Family/variant UI derivation is duplicated three times.
   - Create-trip has inline derivation and a TODO to use `useBillingUiForPayer` (`src/features/trips/components/create-trip/sections/payer-section.tsx:28-30`, `src/features/trips/components/create-trip/sections/payer-section.tsx:57-107`).
   - Recurring billing fields duplicate it (`src/features/clients/components/recurring-rule-billing-fields.tsx:146-201`).
   - Shared helper already exists (`src/features/trips/hooks/use-billing-ui-for-payer.ts:16-101`).

3. Recurring rules currently expose KTS and no-invoice switches whenever a payer is selected, while one-off trips show no-invoice only when the catalog cascade resolves true.
   - One-off no-invoice visibility: `catalogNoInvoiceApplies` (`src/features/trips/components/create-trip/create-trip-form.tsx:511-525`, `src/features/trips/components/create-trip/sections/payer-section.tsx:302-331`).
   - Recurring no-invoice visibility: `watchedPayerId ? ... : null` (`src/features/clients/components/recurring-rule-billing-fields.tsx:357-389`).

4. Recurring rules do not yet model route station fields at all, so the station field UX should be purpose-built and not copied from passenger badges.

## Concrete Reuse Recommendation

Directly reuse:

- `useTripFormData()` from `src/features/trips/hooks/use-trip-form-data.ts`.
- `PayerOption` and `BillingVariantOption` from `src/features/trips/types/trip-form-reference.types.ts`.
- `normalizeBillingTypeBehavior()` and `parseBehaviorProfileRaw()` from `src/features/trips/lib/normalize-billing-type-behavior-profile.ts`.
- `resolveBillingBehaviorSourceVariant()` from `src/features/trips/lib/resolve-billing-behavior-source.ts`.
- `computeBillingUiDerived()` / `computeBillingFamilies()` from `src/features/trips/hooks/use-billing-ui-for-payer.ts`.
- `resolveKtsDefault()` and `resolveNoInvoiceRequiredDefault()` for existing billing defaults.

## Divergence Recommendation

Purpose-build recurring-rule station inputs and validation inside `RecurringRuleFormBody` because recurring rules are route templates with one pickup and one dropoff station, while the one-off trip UI is a passenger/address-group editor with per-passenger station chips.

Do not reuse `TripFormSectionsProvider`, `CreateTripPickupSection`, `CreateTripDropoffSection`, `AddressGroupCard`, or `PassengerBadge` for recurring rules. Their state model would add unnecessary passenger/group complexity to a two-station rule form.

## Revised File Change List For Recurring-Rule Station Feature

- `supabase/migrations/<timestamp>_recurring_rules_stations.sql`: add nullable `pickup_station` and `dropoff_station` to `public.recurring_rules`.
- `src/types/database.types.ts`: regenerate `recurring_rules.Row`, `Insert`, and `Update`.
- `src/features/clients/components/recurring-rule-form-body.tsx`: add station form fields, defaults, validation, and behavior resolution using shared behavior helpers.
- `src/features/clients/components/recurring-rule-billing-fields.tsx`: replace duplicated family/variant derivation with `computeBillingUiDerived()` or expose `effectiveFamilyId`/selected behavior to the body so station validation can apply at family selection time.
- `src/features/clients/lib/build-recurring-rule-payload.ts`: persist normalized station values to `recurring_rules`.
- `src/lib/recurring-trip-generator.ts`: map rule station values into outbound trips and swapped return trips.
- `src/features/trips/lib/__tests__/recurring-trip-generator*.test.ts` or equivalent: cover outbound station copy and return-leg station swap.
- `docs/features/recurring-rules-overview.md`: document route station behavior and clarify it is not `billing_calling_station`.
- Optional cleanup before/with feature: update `CreateTripPayerSection` and `RecurringRuleBillingFields` to share `computeBillingUiDerived()` so family/variant behavior does not drift.

## One-Sentence Recommendation

The existing payer-capability pattern is good enough to extend to recurring rules as-is for station fields, but the family/variant UI derivation should be cleaned up soon by reusing the existing shared helper to avoid another round of duplicated billing behavior logic.
