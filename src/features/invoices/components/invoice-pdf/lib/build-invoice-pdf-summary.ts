/**
 * Builds grouped route rows for the invoice PDF cover table and direction
 * labels (Hinfahrt / Rückfahrt) shared with the appendix.
 *
 * Counts rides per route key using line-item index order (firstSeen), not
 * `quantity`, because quantity can represent billing units rather than trips.
 */

import type { InvoiceDetail } from '../../../types/invoice.types';

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

export function buildInvoicePdfSummary(
  invoice: InvoiceDetail
): InvoicePdfSummaryBuildResult {
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

    const routeKey = `${from.key} -> ${to.key} [${rate}]`;

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
    routeGroups[routeKey].total_price += calculateInvoicePdfNetAmount(
      item.unit_price,
      item.quantity
    );
  });

  const routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel> =
    {};

  Object.entries(routeGroups).forEach(([routeKey, group]) => {
    const reverseKey = `${group.to.key} -> ${group.from.key} [${group.tax_rate}]`;
    const reverseGroup = routeGroups[reverseKey];

    routeDirectionLabels[routeKey] = reverseGroup
      ? reverseGroup.firstSeen < group.firstSeen
        ? 'Rückfahrt'
        : 'Hinfahrt'
      : 'Fahrt';
  });

  const summaryItems: InvoicePdfSummaryRow[] = Object.values(routeGroups)
    .map((g, idx) => ({
      id: `summary-${idx}`,
      position: idx + 1,
      from: g.from,
      to: g.to,
      tax_rate: g.tax_rate,
      total_price: g.total_price,
      quantity: g.count,
      firstSeen: g.firstSeen
    }))
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((g, idx) => {
      const directionLabel =
        routeDirectionLabels[`${g.from.key} -> ${g.to.key} [${g.tax_rate}]`];

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
