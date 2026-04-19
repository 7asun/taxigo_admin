import type { Trip } from '@/features/trips/api/trips.service';
import type { Payer } from '@/features/payers/types/payer.types';

export interface PayerDistributionData {
  payerId: string;
  name: string;
  count: number;
  fill: string;
}

export interface BillingTypeDistributionData {
  billingTypeId: string;
  name: string;
  count: number;
  fill: string;
}

export interface BillingVariantDistributionData {
  billingVariantId: string;
  name: string;
  code: string;
  count: number;
  fill: string;
}

/**
 * Aggregates trips by payer to show distribution
 */
export function getPayerDistribution(
  trips: Trip[],
  payers: Payer[]
): PayerDistributionData[] {
  const distributionMap = new Map<string, number>();

  trips.forEach((trip) => {
    const payerId = trip.payer_id || 'unknown';
    distributionMap.set(payerId, (distributionMap.get(payerId) || 0) + 1);
  });

  const chartColors = [
    'var(--primary)',
    'var(--primary-light)',
    'var(--primary-lighter)',
    'var(--primary-dark)',
    'var(--primary-darker)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)'
  ];

  return Array.from(distributionMap.entries())
    .map(([payerId, count], index) => {
      const payer = payers.find((p) => p.id === payerId);
      return {
        payerId,
        name: payer
          ? payer.name
          : payerId === 'unknown'
            ? 'Unbekannt'
            : payerId,
        count,
        fill: chartColors[index % chartColors.length]
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregates trips by billing type (Abrechnungsart) to show distribution
 */
export function getBillingTypeDistribution(
  trips: Trip[],
  billingTypes: { id: string; name: string; color: string | null }[]
): BillingTypeDistributionData[] {
  const distributionMap = new Map<string, number>();

  trips.forEach((trip) => {
    // billing_variant is not included in the base Trip type, so we need to handle this
    // This will be called with enriched trips that include billing_variant data
    const billingVariant = (trip as any).billing_variant;
    const billingTypeId = billingVariant?.billing_type_id || 'unknown';
    distributionMap.set(
      billingTypeId,
      (distributionMap.get(billingTypeId) || 0) + 1
    );
  });

  const chartColors = [
    'var(--primary)',
    'var(--primary-light)',
    'var(--primary-lighter)',
    'var(--primary-dark)',
    'var(--primary-darker)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)'
  ];

  return Array.from(distributionMap.entries())
    .map(([billingTypeId, count], index) => {
      const billingType = billingTypes.find((bt) => bt.id === billingTypeId);
      return {
        billingTypeId,
        name: billingType
          ? billingType.name
          : billingTypeId === 'unknown'
            ? 'Unbekannt'
            : billingTypeId,
        count,
        fill: billingType?.color || chartColors[index % chartColors.length]
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregates trips by billing variant (Unterart) to show distribution
 */
export function getBillingVariantDistribution(
  trips: Trip[]
): BillingVariantDistributionData[] {
  const distributionMap = new Map<
    string,
    { name: string; code: string; count: number }
  >();

  trips.forEach((trip) => {
    const billingVariant = (trip as any).billing_variant;
    const billingVariantId = billingVariant?.id || 'unknown';
    const existing = distributionMap.get(billingVariantId);
    if (existing) {
      existing.count += 1;
    } else {
      distributionMap.set(billingVariantId, {
        name: billingVariant?.name || 'Unbekannt',
        code: billingVariant?.code || '',
        count: 1
      });
    }
  });

  const chartColors = [
    'var(--primary)',
    'var(--primary-light)',
    'var(--primary-lighter)',
    'var(--primary-dark)',
    'var(--primary-darker)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)'
  ];

  return Array.from(distributionMap.entries())
    .map(([billingVariantId, data], index) => ({
      billingVariantId,
      name: data.name,
      code: data.code,
      count: data.count,
      fill: chartColors[index % chartColors.length]
    }))
    .sort((a, b) => b.count - a.count);
}
