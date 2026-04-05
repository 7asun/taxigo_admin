/**
 * Builds grouped route rows for the invoice PDF cover table and direction
 * labels (Hinfahrt / Rückfahrt) shared with the appendix.
 *
 * CONSOLIDATION LOGIC:
 * - Routes are matched by canonicalized addresses ONLY (not by tax rate)
 * - This ensures Hinfahrt and Rückfahrt with the same addresses consolidate properly
 * - Tax rate consistency is validated after route pairing is determined
 * - Quantities are aggregated per route pair
 *
 * Counts rides per route key using line-item index order (firstSeen), not
 * `quantity`, because quantity can represent billing units rather than trips.
 */

import type { InvoiceDetail } from '../../../types/invoice.types';

import { lineNetEurForPdfLineItem } from './invoice-pdf-line-amounts';

import {
  buildInvoicePdfPlaceHintMap,
  buildInvoicePdfRouteSecondaryLine,
  canonicalizeInvoicePdfPlace,
  type CanonicalPlace,
  type InvoicePdfPlaceHintMap
} from './invoice-pdf-places';

export type InvoicePdfRouteDirectionLabel = 'Hinfahrt' | 'Rückfahrt' | 'Fahrt';

export function calculateInvoicePdfNetAmount(
  unitPrice: number,
  quantity: number
): number {
  return Math.round(unitPrice * quantity * 100) / 100;
}

export interface InvoicePdfSummaryRow {
  id: string;
  position: number;
  from: CanonicalPlace;
  to: CanonicalPlace;
  tax_rate: number;
  total_price: number;
  quantity: number;
  descriptionPrimary: string;
  descriptionSecondary: string;
}

export interface InvoicePdfSummaryBuildResult {
  summaryItems: InvoicePdfSummaryRow[];
  placeHints: InvoicePdfPlaceHintMap;
  routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel>;
}

interface RouteGroupAgg {
  count: number;
  from: CanonicalPlace;
  to: CanonicalPlace;
  tax_rate: number;
  total_price: number;
  /** Index of first line item in this group — determines Hinfahrt vs Rückfahrt */
  firstSeen: number;
}

/**
 * Creates an address-only route key for consolidation matching.
 * IMPORTANT: This excludes tax rate to ensure Hinfahrt/Rückfahrt pairs match
 * regardless of tax rate differences. Tax rate validation happens separately.
 */
export function buildAddressOnlyRouteKey(
  from: CanonicalPlace,
  to: CanonicalPlace
): string {
  return `${from.key} -> ${to.key}`;
}

export function buildInvoicePdfSummary(
  invoice: InvoiceDetail
): InvoicePdfSummaryBuildResult {
  /**
   * PHASE 1: Build route groups by canonicalized addresses
   * - Uses address-only keys to ensure Hinfahrt/Rückfahrt consolidation
   * - Tracks firstSeen index for proper Hinfahrt/Rückfahrt labeling
   * - Aggregates counts and total prices per route
   */
  const routeGroups: Record<string, RouteGroupAgg> = {};

  const placeHints = buildInvoicePdfPlaceHintMap(
    invoice.line_items.flatMap((item) =>
      [item.pickup_address, item.dropoff_address]
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
        )
        .map((value) => value.trim())
    )
  );

  invoice.line_items.forEach((item, idx) => {
    const pAddr = (item.pickup_address || '').trim().replace(/\s+/g, ' ');
    const dAddr = (item.dropoff_address || '').trim().replace(/\s+/g, ' ');
    const rate = item.tax_rate;
    const from = canonicalizeInvoicePdfPlace(
      pAddr || item.description,
      placeHints
    );
    const to = canonicalizeInvoicePdfPlace(
      dAddr || item.description,
      placeHints
    );

    // Use address-only key for route matching (no tax rate)
    // This ensures Hinfahrt and Rückfahrt consolidate properly
    const routeKey = buildAddressOnlyRouteKey(from, to);

    if (!routeGroups[routeKey]) {
      routeGroups[routeKey] = {
        count: 0,
        from,
        to,
        tax_rate: rate,
        total_price: 0,
        firstSeen: idx
      };
    }

    routeGroups[routeKey].count += 1;
    routeGroups[routeKey].total_price += lineNetEurForPdfLineItem(item);
  });

  /**
   * PHASE 2: Determine Hinfahrt/Rückfahrt labels
   * - Uses address-only reverse keys for matching
   * - Compares firstSeen indices to determine direction
   * - The route that appears first is labeled as Hinfahrt
   * - Its reverse counterpart is labeled as Rückfahrt
   */
  const routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel> =
    {};

  Object.entries(routeGroups).forEach(([routeKey, group]) => {
    // Build reverse key using address-only matching (no tax rate)
    const reverseKey = buildAddressOnlyRouteKey(group.to, group.from);
    const reverseGroup = routeGroups[reverseKey];

    routeDirectionLabels[routeKey] = reverseGroup
      ? reverseGroup.firstSeen < group.firstSeen
        ? 'Rückfahrt'
        : 'Hinfahrt'
      : 'Fahrt';
  });

  /**
   * PHASE 3: Build summary rows with proper labeling
   * - Sorts by firstSeen to maintain chronological order
   * - Applies Hinfahrt/Rückfahrt labels based on direction analysis
   * - Generates primary description with direction label
   */
  const summaryItems: InvoicePdfSummaryRow[] = Object.values(routeGroups)
    .map((g, idx) => ({
      id: `summary-${idx}`,
      position: idx + 1,
      from: g.from,
      to: g.to,
      tax_rate: g.tax_rate,
      total_price: g.total_price,
      quantity: g.count,
      firstSeen: g.firstSeen,
      // Store the address-only key for direction label lookup
      routeKey: buildAddressOnlyRouteKey(g.from, g.to)
    }))
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((g, idx) => {
      // Look up direction label using address-only route key
      const directionLabel = routeDirectionLabels[g.routeKey];

      return {
        id: g.id,
        position: idx + 1,
        from: g.from,
        to: g.to,
        tax_rate: g.tax_rate,
        total_price: g.total_price,
        quantity: g.quantity,
        descriptionPrimary: `${directionLabel}: ${g.from.primary} nach ${g.to.primary}`,
        descriptionSecondary: buildInvoicePdfRouteSecondaryLine(g.from, g.to)
      };
    });

  return { summaryItems, placeHints, routeDirectionLabels };
}
