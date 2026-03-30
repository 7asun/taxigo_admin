'use client';

import { useMemo } from 'react';
import type { BillingVariantOption } from '@/features/trips/types/trip-form-reference.types';

/** One Abrechnungsfamilie row for selects (distinct `billing_type_id`). */
export interface BillingFamilyOption {
  id: string;
  name: string;
}

/**
 * Distinct families from the flattened variant list returned by
 * `fetchBillingVariantsForPayer` — same reduction as `CreateTripPayerSection`.
 */
export function computeBillingFamilies(
  billingTypes: BillingVariantOption[]
): BillingFamilyOption[] {
  const map = new Map<string, string>();
  for (const v of billingTypes) {
    if (!map.has(v.billing_type_id)) {
      map.set(v.billing_type_id, v.billing_type_name);
    }
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

export interface BillingUiDerived {
  families: BillingFamilyOption[];
  effectiveFamilyId: string;
  variantsInEffectiveFamily: BillingVariantOption[];
  showFamilySelect: boolean;
  needVariantDropdown: boolean;
  singleVariantInScope: boolean;
}

/**
 * Derived flags for Kostenträger billing UI (Neue Fahrt, Trip-Detail).
 *
 * **Keep in sync** with `CreateTripPayerSection` in
 * `src/features/trips/components/create-trip/sections/payer-section.tsx`.
 * (`families`, `effectiveFamilyId`, `variantsInEffectiveFamily`, `showFamilySelect`,
 * `needVariantDropdown`, `singleVariantInScope`).
 */
export function computeBillingUiDerived({
  billingTypes,
  selectedFamilyId,
  watchedPayerId
}: {
  billingTypes: BillingVariantOption[];
  selectedFamilyId: string;
  watchedPayerId: string;
}): BillingUiDerived {
  const families = computeBillingFamilies(billingTypes);
  const effectiveFamilyId =
    families.length === 1 ? (families[0]?.id ?? '') : selectedFamilyId;

  const variantsInEffectiveFamily = !effectiveFamilyId
    ? []
    : billingTypes.filter((v) => v.billing_type_id === effectiveFamilyId);

  const showFamilySelect = families.length > 1;
  const needVariantDropdown =
    !!watchedPayerId &&
    billingTypes.length > 0 &&
    variantsInEffectiveFamily.length > 1 &&
    (families.length === 1 || !!selectedFamilyId);

  const singleVariantInScope =
    !!effectiveFamilyId && variantsInEffectiveFamily.length === 1;

  return {
    families,
    effectiveFamilyId,
    variantsInEffectiveFamily,
    showFamilySelect,
    needVariantDropdown,
    singleVariantInScope
  };
}

/**
 * Memoized `computeBillingUiDerived` for React callers (`selectedFamilyId` = Abrechnungsfamilie
 * draft when `showFamilySelect`; otherwise unused because `effectiveFamilyId` collapses to the
 * sole family).
 */
export function useBillingUiForPayer(
  watchedPayerId: string | undefined,
  billingTypes: BillingVariantOption[],
  selectedFamilyId: string
): BillingUiDerived {
  return useMemo(
    () =>
      computeBillingUiDerived({
        billingTypes,
        selectedFamilyId,
        watchedPayerId: watchedPayerId ?? ''
      }),
    [billingTypes, selectedFamilyId, watchedPayerId]
  );
}
