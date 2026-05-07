/**
 * Builds `InvoicePdfSummaryRow` objects for grouped, single-row, and
 * billing-type-grouped PDF layouts.
 *
 * ## Net column contract (per-anchor)
 *
 * The cover NET fields (`transport_costs_net`, `approach_costs_net`, `total_price`)
 * are accumulated **per anchor**, mirroring how `insertLineItems` writes per-line
 * `total_price`:
 *
 * - **Net-anchor lines** (every strategy except `client_price_tag`): per-line
 *   transport net is read **directly from `price_resolution_snapshot.net`**
 *   (defensively coerced — PostgREST may deliver JSONB as a string), with a
 *   documented fallback to `unit_price × quantity` for legacy / unresolved rows
 *   that lack a snapshot. `approach_fee_net` is summed separately. The net column
 *   is therefore identical to the resolver's authoritative net (e.g. tiered
 *   `tieredNetTotal`) — not a reverse-engineered value derived from gross.
 *
 * - **Gross-anchor lines** (`client_price_tag`): gross **is** the pricing anchor,
 *   so per-line transport net is back-derived from the stored line gross:
 *   `lineGross / (1 + tax_rate) − approach_fee_net`. This matches the resolver's
 *   `unit_price_net = round(gross / (1 + tax))` and remains stable across
 *   pre-fix and post-fix invoices.
 *
 * ## Brutto column
 *
 * `total_costs_gross` continues to sum per-line `lineGrossEurForPdfLineItem`
 * (stored `invoice_line_items.total_price`). It is the customer-facing number
 * and unchanged by this contract.
 *
 * Do **not** revert the net-anchor branch to `SUM(unit_price × qty)` or to a
 * group-level `round(totalGross / (1 + tax))` back-derivation — both lose the
 * resolver's tiered precision (e.g. `(48.52 − 4.07) / 1.07 = 41.542 ≠ 41.55`).
 *
 * ---
 *
 * **Route consolidation:** routes are matched by canonicalized addresses ONLY (not by tax rate)
 * so Hinfahrt/Rückfahrt pairs consolidate; tax rate consistency is validated after pairing.
 *
 * **Trip count:** uses line-item index order (`firstSeen`), not `quantity`, because quantity can
 * represent billing units (e.g. km) rather than trips.
 */

import type {
  InvoiceDetail,
  InvoiceLineItemRow
} from '../../../types/invoice.types';

import {
  lineGrossEurForPdfLineItem,
  lineNetEurForPdfLineItem
} from './invoice-pdf-line-amounts';

import { coerceLineItemJsonbSnapshots } from '@/features/invoices/components/invoice-pdf/pdf-column-layout';

import {
  buildInvoicePdfPlaceHintMap,
  buildInvoicePdfRouteSecondaryLine,
  canonicalizeInvoicePdfPlace,
  type CanonicalPlace,
  type InvoicePdfPlaceHintMap
} from './invoice-pdf-places';

/**
 * Per-line **transport net** (€), no approach. Anchor-aware:
 *
 * - Gross-anchor (`price_resolution_snapshot.strategy_used === 'client_price_tag'`):
 *   `lineGross / (1 + tax_rate) − approach_fee_net`.
 * - Net-anchor: `price_resolution_snapshot.net` (parsed defensively — PostgREST may
 *   return JSONB as a string), with fallback to `unit_price × quantity` for legacy
 *   rows that lack a snapshot.
 *
 * KTS rows return `0` (mirrors `lineNetEurForPdfLineItem` / `lineGrossEurForPdfLineItem`).
 */
function transportNetEurForPdfLineItem(item: InvoiceLineItemRow): number {
  if (item.kts_override) return 0;
  const coerced = coerceLineItemJsonbSnapshots(item);
  const snap = coerced.price_resolution_snapshot as
    | { net?: number | string | null; strategy_used?: string | null }
    | null
    | undefined;

  // why: gross is the pricing anchor for client_price_tag; back-derive per-line so
  // the cover NET column matches the resolver's unit_price_net = round(gross / (1+tax)).
  if (snap?.strategy_used === 'client_price_tag') {
    const lineGross = lineGrossEurForPdfLineItem(item);
    return lineGross / (1 + item.tax_rate) - (item.approach_fee_net ?? 0);
  }

  const rawNet = snap?.net;
  const snapNet =
    typeof rawNet === 'number'
      ? rawNet
      : typeof rawNet === 'string' && rawNet.trim() !== ''
        ? Number(rawNet)
        : null;
  if (snapNet !== null && Number.isFinite(snapNet)) return snapNet;
  // why: legacy / unresolved net-anchor rows lack snapshot.net; fall back to
  // columnar transport net (unit_price × quantity). For new rows where snapshot.net
  // is authoritative, this branch never runs.
  return (item.unit_price ?? 0) * item.quantity;
}

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
  /** Sum of billed km (`effective_distance_km` with legacy fallback to `distance_km`); null if any line lacks a value. */
  total_km: number | null;
  /** Sum of `approach_fee_net` (net) in group. */
  approach_costs_net: number;
  /** Base transport net = total_price − approach_costs_net. */
  transport_costs_net: number;
  /** Sum of per-line stored gross (`total_price`) for the group — not net × (1 + tax_rate). */
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
  /** True if any line in the group has null billed km (effective, else routing snapshot). */
  has_null_km: boolean;
  /** Sum of `approach_fee_net` (null treated as 0). */
  approach_costs_net: number;
  /** Running sum of line gross via `lineGrossEurForPdfLineItem` (stored `total_price`). */
  total_gross: number;
  /**
   * Running sum of per-line **transport net** (no approach) from
   * `transportNetEurForPdfLineItem`. Net-anchor lines contribute `snapshot.net`
   * (with `unit_price × quantity` fallback); gross-anchor lines contribute
   * `lineGross / (1 + tax) − approach_fee_net`. Drives `transport_costs_net` /
   * `total_price` (NET) on the output row — read directly, never back-derived
   * from the gross sum.
   */
  total_net_for_gross: number;
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

/**
 * Human-readable Abrechnungsart label for PDF grouping (`main_layout: grouped_by_billing_type`)
 * and matching appendix sections.
 *
 * // why: Line items always snapshot `billing_type_name` (billing_types.name — e.g. Abreise, Anreise).
 * The Unterart name (`billing_variant_name`) is often the generic **"Standard"**; using it as the
 * group label made the PDF show "Standard" instead of the real Abrechnungsfamilie. Legacy rows
 * without `billing_type_name` keep the previous fallback chain.
 */
export function invoicePdfBillingCategoryLabel(
  item: Pick<
    InvoiceLineItemRow,
    'billing_type_name' | 'billing_variant_name' | 'billing_variant_code'
  >
): string {
  const family = item.billing_type_name?.trim();
  if (family) return family;
  return item.billing_variant_name ?? item.billing_variant_code ?? 'Unbekannt';
}

function summaryRowFromAgg(
  g: RouteGroupAgg & { routeKey: string; id: string },
  idx: number,
  directionLabel: InvoicePdfRouteDirectionLabel
): InvoicePdfSummaryRow {
  const totalGross = Math.round(g.total_gross * 100) / 100;
  // Net column read directly from per-line accumulators; never back-derived from
  // gross. See `transportNetEurForPdfLineItem` for the per-anchor source.
  const transportNet = Math.round(g.total_net_for_gross * 100) / 100;
  const approachNet = Math.round(g.approach_costs_net * 100) / 100;
  const totalNet = Math.round((transportNet + approachNet) * 100) / 100;
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
        total_gross: 0,
        total_net_for_gross: 0,
        firstSeen: idx
      };
    }

    const group = routeGroups[routeKey];
    group.count += 1;
    group.total_price += lineNetEurForPdfLineItem(item);
    group.total_gross += lineGrossEurForPdfLineItem(item);
    // why: per-line transport net read directly (anchor-aware); summed independently of gross
    // so the cover NET column shows the resolver's authoritative value, not a back-derivation.
    group.total_net_for_gross += transportNetEurForPdfLineItem(item);
    group.approach_costs_net += item.approach_fee_net ?? 0;
    const lineKm = item.effective_distance_km ?? item.distance_km;
    if (lineKm == null) {
      group.has_null_km = true;
    } else if (!group.has_null_km) {
      group.total_km += Number(lineKm);
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
  let totalGrossAccum = 0;
  let totalNetForGross = 0;
  let approachNetAccum = 0;
  let totalKm = 0;
  let hasNullKm = false;
  const tax_rate = lineItems[0]!.tax_rate;

  for (const item of lineItems) {
    count += 1;
    totalGrossAccum += lineGrossEurForPdfLineItem(item);
    // why: anchor-aware per-line transport net (snapshot.net for net-anchor;
    // back-derivation for gross-anchor) — see transportNetEurForPdfLineItem.
    totalNetForGross += transportNetEurForPdfLineItem(item);
    approachNetAccum += item.approach_fee_net ?? 0;
    const lineKm = item.effective_distance_km ?? item.distance_km;
    if (lineKm == null) {
      hasNullKm = true;
    } else if (!hasNullKm) {
      totalKm += Number(lineKm);
    }
  }

  const totalGross = Math.round(totalGrossAccum * 100) / 100;
  const transportNet = Math.round(totalNetForGross * 100) / 100;
  const approachNet = Math.round(approachNetAccum * 100) / 100;
  const totalNet = Math.round((transportNet + approachNet) * 100) / 100;

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
 * Groups invoice line items by Abrechnungsfamilie + tax rate, producing one
 * `InvoicePdfSummaryRow` per unique `(invoicePdfBillingCategoryLabel(item), tax_rate)` combination.
 *
 * **Label source:** Prefer snapshotted **`billing_type_name`** (`billing_types.name` — e.g. Abreise,
 * Anreise). Falls back to `billing_variant_name` / `billing_variant_code` when the family name was
 * not stored (legacy). See {@link invoicePdfBillingCategoryLabel}.
 *
 * **Why the composite key includes `tax_rate`:**
 * Including the tax rate in the key ensures every output row has exactly one MwSt. rate — no
 * approximations, no mixed-rate rounding ambiguity. If a billing variant spans both 7% and 19%
 * trips (rare but legal), they simply appear as two separate summary rows, each clearly labelled by
 * the `tax_rate` column. No `console.warn` or special-case logic is needed.
 *
 * **Example:**
 * - Input: 80 × family "Krankenfahrt" at 7%, 4 × same at 19%, 32 × "Dialyse" at 7%.
 * - Output: row 1 → Krankenfahrt 7%, row 2 → Krankenfahrt 19%, row 3 → Dialyse 7%.
 *
 * **`descriptionPrimary` / `description`:** the Abrechnungsfamilie label (or legacy variant label).
 * The tax rate is already shown by the `tax_rate` column — do not repeat it in the label.
 *
 * **`from` / `to`:** set to `EMPTY_CANONICAL_PLACE`. Origin/destination addresses are not
 * meaningful at billing-category level; the `route_leistung` grouped column renderer will show
 * the description text only (primary with empty secondary).
 *
 * **`total_km`:** `null` when **any** trip in the group has a `null` billed km (`effective_distance_km`,
 * with legacy fallback to `distance_km`). A partial km sum would be misleading, so the whole group shows `—`.
 *
 * @param lineItems — persisted `InvoiceLineItemRow[]` from `invoice.line_items`.
 * @returns sorted array of `InvoicePdfSummaryRow` alphabetically by label (de-DE), then by tax_rate ascending.
 */
export function buildInvoicePdfGroupedByBillingType(
  lineItems: InvoiceLineItemRow[]
): InvoicePdfSummaryRow[] {
  interface BillingTypeAgg {
    /** Human-readable label — {@link invoicePdfBillingCategoryLabel} (family first). */
    label: string;
    count: number;
    total_price: number;
    total_gross: number;
    /**
     * Running sum of per-line transport net from `transportNetEurForPdfLineItem`
     * (anchor-aware: snapshot.net for net-anchor, back-derivation for gross-anchor).
     */
    total_net_for_gross: number;
    total_km: number;
    has_null_km: boolean;
    approach_costs_net: number;
    tax_rate: number;
  }

  const groups: Record<string, BillingTypeAgg> = {};

  lineItems.forEach((item) => {
    const label = invoicePdfBillingCategoryLabel(item);
    // Composite key: label + tax_rate guarantees no mixed-rate rows within a group.
    const key = `${label}__${item.tax_rate}`;

    if (!groups[key]) {
      groups[key] = {
        label,
        count: 0,
        total_price: 0,
        total_gross: 0,
        total_net_for_gross: 0,
        total_km: 0,
        has_null_km: false,
        approach_costs_net: 0,
        tax_rate: item.tax_rate
      };
    }

    const g = groups[key];
    g.count += 1;
    g.total_price += lineNetEurForPdfLineItem(item);
    g.total_gross += lineGrossEurForPdfLineItem(item);
    // why: anchor-aware per-line transport net summed directly — net column never
    // reverse-engineered from cent-rounded gross sum.
    g.total_net_for_gross += transportNetEurForPdfLineItem(item);
    g.approach_costs_net += item.approach_fee_net ?? 0;
    const lineKm = item.effective_distance_km ?? item.distance_km;
    if (lineKm == null) {
      g.has_null_km = true;
    } else if (!g.has_null_km) {
      g.total_km += Number(lineKm);
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
      const totalGross = Math.round(g.total_gross * 100) / 100;
      const transportNet = Math.round(g.total_net_for_gross * 100) / 100;
      const approachNet = Math.round(g.approach_costs_net * 100) / 100;
      const totalNet = Math.round((transportNet + approachNet) * 100) / 100;
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
 * Groups flat line items by {@link invoicePdfBillingCategoryLabel} for the appendix.
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
    const label = invoicePdfBillingCategoryLabel(item);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(item);
  }

  return order.map((label) => ({ label, items: map.get(label)! }));
}
