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
 *
 * Phase 8: per-group `total_km`, `approach_costs_net`, `transport_costs_net`, `total_costs_gross`
 * use line net from `lineNetEurForPdfLineItem` (base + approach) and column `approach_fee_net`.
 */

import type {
  InvoiceDetail,
  InvoiceLineItemRow
} from '../../../types/invoice.types';

import { lineNetEurForPdfLineItem } from './invoice-pdf-line-amounts';

import {
  buildInvoicePdfPlaceHintMap,
  buildInvoicePdfRouteSecondaryLine,
  canonicalizeInvoicePdfPlace,
  type CanonicalPlace,
  type InvoicePdfPlaceHintMap
} from './invoice-pdf-places';

export type InvoicePdfRouteDirectionLabel = 'Hinfahrt' | 'Rückfahrt' | 'Fahrt';

// Placeholder for grouped rows where from/to address is not meaningful (e.g. billing-type groups)
const EMPTY_CANONICAL_PLACE: CanonicalPlace = {
  key: '',
  primary: '',
  secondary: ''
};

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
  /** Aggregated total line net for the group (Beförderung + Anfahrt). */
  total_price: number;
  /** Trip count in this group (not billing quantity). */
  quantity: number;
  descriptionPrimary: string;
  descriptionSecondary: string;
  /** Same as descriptionPrimary — PDF catalog `description` column uses dataField `description`. */
  description: string;
  /** Sum of `distance_km` in group; null if any line has null distance. */
  total_km: number | null;
  /** Sum of `approach_fee_net` (net) in group. */
  approach_costs_net: number;
  /** Base transport net = total_price − approach_costs_net. */
  transport_costs_net: number;
  /** Gross for group = total net × (1 + tax_rate). */
  total_costs_gross: number;
}

export interface InvoicePdfSummaryBuildResult {
  summaryItems: InvoicePdfSummaryRow[];
  placeHints: InvoicePdfPlaceHintMap;
  routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel>;
}

interface RouteGroupAgg {
  /** Trip count in this route group. */
  count: number;
  from: CanonicalPlace;
  to: CanonicalPlace;
  tax_rate: number;
  /** Running sum of line net (incl. approach) via `lineNetEurForPdfLineItem`. */
  total_price: number;
  /** Sum of km when all lines have distance; meaningless while `has_null_km`. */
  total_km: number;
  /** True if any line in the group has null `distance_km`. */
  has_null_km: boolean;
  /** Sum of `approach_fee_net` (null treated as 0). */
  approach_costs_net: number;
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

function summaryRowFromAgg(
  g: RouteGroupAgg & { routeKey: string; id: string },
  idx: number,
  directionLabel: InvoicePdfRouteDirectionLabel
): InvoicePdfSummaryRow {
  const totalNet = Math.round(g.total_price * 100) / 100;
  const approachNet = Math.round(g.approach_costs_net * 100) / 100;
  const transportNet = Math.round((totalNet - approachNet) * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + g.tax_rate) * 100) / 100;
  const descriptionPrimary = `${directionLabel}: ${g.from.primary} nach ${g.to.primary}`;
  return {
    id: g.id,
    position: idx + 1,
    from: g.from,
    to: g.to,
    tax_rate: g.tax_rate,
    total_price: totalNet,
    quantity: g.count,
    descriptionPrimary,
    descriptionSecondary: buildInvoicePdfRouteSecondaryLine(g.from, g.to),
    description: descriptionPrimary,
    total_km: g.has_null_km ? null : Math.round(g.total_km * 100) / 100,
    approach_costs_net: approachNet,
    transport_costs_net: transportNet,
    total_costs_gross: totalGross
  };
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

    const routeKey = buildAddressOnlyRouteKey(from, to);

    if (!routeGroups[routeKey]) {
      routeGroups[routeKey] = {
        count: 0,
        from,
        to,
        tax_rate: rate,
        total_price: 0,
        total_km: 0,
        has_null_km: false,
        approach_costs_net: 0,
        firstSeen: idx
      };
    }

    const group = routeGroups[routeKey];
    group.count += 1;
    group.total_price += lineNetEurForPdfLineItem(item);
    group.approach_costs_net += item.approach_fee_net ?? 0;
    if (item.distance_km == null) {
      group.has_null_km = true;
    } else if (!group.has_null_km) {
      group.total_km += Number(item.distance_km);
    }
  });

  const routeDirectionLabels: Record<string, InvoicePdfRouteDirectionLabel> =
    {};

  Object.entries(routeGroups).forEach(([routeKey, group]) => {
    const reverseKey = buildAddressOnlyRouteKey(group.to, group.from);
    const reverseGroup = routeGroups[reverseKey];

    routeDirectionLabels[routeKey] = reverseGroup
      ? reverseGroup.firstSeen < group.firstSeen
        ? 'Rückfahrt'
        : 'Hinfahrt'
      : 'Fahrt';
  });

  const summaryItems: InvoicePdfSummaryRow[] = Object.values(routeGroups)
    .map((g) => ({
      ...g,
      routeKey: buildAddressOnlyRouteKey(g.from, g.to)
    }))
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((g, idx) => {
      const directionLabel = routeDirectionLabels[g.routeKey];
      return summaryRowFromAgg(
        { ...g, id: `summary-${idx}` },
        idx,
        directionLabel
      );
    });

  return { summaryItems, placeHints, routeDirectionLabels };
}

/**
 * Collapses all invoice lines into one `InvoicePdfSummaryRow` (no route grouping).
 * Use when `main_layout === 'single_row'`: same row shape as grouped mode for column pickers.
 *
 * @param lineItems — persisted line items (same source as cover `invoice.line_items`).
 * @param label — Primary description (e.g. payer + period); shown as route-style title.
 */
export function buildInvoicePdfSingleRow(
  lineItems: InvoiceLineItemRow[],
  label: string
): InvoicePdfSummaryRow {
  const placeholder: CanonicalPlace = {
    key: 'single-row',
    primary: label,
    secondary: ''
  };
  const placeholderTo: CanonicalPlace = {
    key: 'single-row-to',
    primary: '',
    secondary: ''
  };

  if (lineItems.length === 0) {
    return {
      id: 'summary-single',
      position: 1,
      from: placeholder,
      to: placeholderTo,
      tax_rate: 0,
      total_price: 0,
      quantity: 0,
      descriptionPrimary: label,
      descriptionSecondary: '',
      description: label,
      total_km: null,
      approach_costs_net: 0,
      transport_costs_net: 0,
      total_costs_gross: 0
    };
  }

  let count = 0;
  let totalNet = 0;
  let approachNet = 0;
  let totalKm = 0;
  let hasNullKm = false;
  const tax_rate = lineItems[0]!.tax_rate;

  for (const item of lineItems) {
    count += 1;
    totalNet += lineNetEurForPdfLineItem(item);
    approachNet += item.approach_fee_net ?? 0;
    if (item.distance_km == null) {
      hasNullKm = true;
    } else if (!hasNullKm) {
      totalKm += Number(item.distance_km);
    }
  }

  totalNet = Math.round(totalNet * 100) / 100;
  approachNet = Math.round(approachNet * 100) / 100;
  const transportNet = Math.round((totalNet - approachNet) * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + tax_rate) * 100) / 100;

  return {
    id: 'summary-single',
    position: 1,
    from: placeholder,
    to: placeholderTo,
    tax_rate,
    total_price: totalNet,
    quantity: count,
    descriptionPrimary: label,
    descriptionSecondary: '',
    description: label,
    total_km: hasNullKm ? null : Math.round(totalKm * 100) / 100,
    approach_costs_net: approachNet,
    transport_costs_net: transportNet,
    total_costs_gross: totalGross
  };
}

/**
 * Groups invoice line items by Abrechnungsart (billing variant) + tax rate, producing one
 * `InvoicePdfSummaryRow` per unique `(billing_variant_name ?? billing_variant_code ?? 'Unbekannt',
 * tax_rate)` combination.
 *
 * **Label source:** `billing_variant_name` is snapshotted as `billing_types.name` (the
 * Abrechnungsfamilie) in `buildLineItemsFromTrips` — `trip.billing_variant.billing_type.name`.
 * The variant name and code are intentionally not used; grouping is always at the family level.
 * Falls back to `'Unbekannt'` only when the line item has no `billing_variant_name`.
 *
 * **Why the composite key includes `tax_rate`:**
 * Including the tax rate in the key ensures every output row has exactly one MwSt. rate — no
 * approximations, no mixed-rate rounding ambiguity. If a billing variant spans both 7% and 19%
 * trips (rare but legal), they simply appear as two separate summary rows, each clearly labelled by
 * the `tax_rate` column. No `console.warn` or special-case logic is needed.
 *
 * **Example:**
 * - Input: 80 × "Krankenfahrt" at 7%, 4 × "Krankenfahrt" at 19%, 32 × "Dialyse" at 7%.
 * - Output: row 1 → Krankenfahrt 7%, row 2 → Krankenfahrt 19%, row 3 → Dialyse 7%.
 *
 * **`descriptionPrimary` / `description`:** the billing variant label only (e.g. "Krankenfahrt").
 * The tax rate is already shown by the `tax_rate` column — do not repeat it in the label.
 *
 * **`from` / `to`:** set to `EMPTY_CANONICAL_PLACE`. Origin/destination addresses are not
 * meaningful at billing-category level; the `route_leistung` grouped column renderer will show
 * the description text only (primary with empty secondary).
 *
 * **`total_km`:** `null` when **any** trip in the group has a `null` `distance_km`. This mirrors
 * route-group semantics — a partial km sum would be misleading, so the whole group shows `—`.
 *
 * @param lineItems — persisted `InvoiceLineItemRow[]` from `invoice.line_items`.
 * @returns sorted array of `InvoicePdfSummaryRow` alphabetically by label (de-DE), then by tax_rate ascending.
 */
export function buildInvoicePdfGroupedByBillingType(
  lineItems: InvoiceLineItemRow[]
): InvoicePdfSummaryRow[] {
  interface BillingTypeAgg {
    /** Human-readable label shown in the PDF description column (billing_types.name). */
    label: string;
    count: number;
    total_price: number;
    total_km: number;
    has_null_km: boolean;
    approach_costs_net: number;
    tax_rate: number;
  }

  const groups: Record<string, BillingTypeAgg> = {};

  lineItems.forEach((item) => {
    // billing_variant_name is snapshotted as billing_types.name (family label) at invoice creation.
    // Code and variant name are intentionally excluded — grouping is always at the family level.
    const label = item.billing_variant_name ?? 'Unbekannt';
    // Composite key: label + tax_rate guarantees no mixed-rate rows within a group.
    const key = `${label}__${item.tax_rate}`;

    if (!groups[key]) {
      groups[key] = {
        label,
        count: 0,
        total_price: 0,
        total_km: 0,
        has_null_km: false,
        approach_costs_net: 0,
        tax_rate: item.tax_rate
      };
    }

    const g = groups[key];
    g.count += 1;
    g.total_price += lineNetEurForPdfLineItem(item);
    g.approach_costs_net += item.approach_fee_net ?? 0;
    if (item.distance_km == null) {
      g.has_null_km = true;
    } else if (!g.has_null_km) {
      g.total_km += Number(item.distance_km);
    }
  });

  // Sort alphabetically by label (de-DE locale), then by tax_rate ascending for consistent ordering
  // when the same family appears at both 7% and 19%.
  return Object.values(groups)
    .sort((a, b) => {
      const labelCmp = a.label.localeCompare(b.label, 'de-DE', {
        sensitivity: 'base'
      });
      return labelCmp !== 0 ? labelCmp : a.tax_rate - b.tax_rate;
    })
    .map((g, i) => {
      const totalNet = Math.round(g.total_price * 100) / 100;
      const approachNet = Math.round(g.approach_costs_net * 100) / 100;
      const transportNet = Math.round((totalNet - approachNet) * 100) / 100;
      const totalGross = Math.round(totalNet * (1 + g.tax_rate) * 100) / 100;
      return {
        id: `billing-type-group-${i}`,
        position: i + 1,
        // from/to not meaningful for billing-type groups — address-based route columns unused here
        from: EMPTY_CANONICAL_PLACE,
        to: EMPTY_CANONICAL_PLACE,
        tax_rate: g.tax_rate,
        total_price: totalNet,
        quantity: g.count,
        descriptionPrimary: g.label,
        descriptionSecondary: '',
        description: g.label,
        total_km: g.has_null_km ? null : Math.round(g.total_km * 100) / 100,
        approach_costs_net: approachNet,
        transport_costs_net: transportNet,
        total_costs_gross: totalGross
      } satisfies InvoicePdfSummaryRow;
    });
}

/**
 * Groups flat line items by billing_variant_name for the appendix.
 * Returns ordered groups preserving original position order within each group.
 * Used by InvoicePdfAppendix when main_layout === 'grouped_by_billing_type'.
 * Does NOT affect column selection — columnProfile.appendix_columns is unchanged.
 */
export function groupLineItemsByBillingType(
  lineItems: InvoiceLineItemRow[]
): { label: string; items: InvoiceLineItemRow[] }[] {
  const order: string[] = [];
  const map = new Map<string, InvoiceLineItemRow[]>();

  for (const item of lineItems) {
    const label = item.billing_variant_name ?? 'Unbekannt';
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(item);
  }

  return order.map((label) => ({ label, items: map.get(label)! }));
}
