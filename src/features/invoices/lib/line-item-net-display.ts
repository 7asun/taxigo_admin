/**
 * Step 3 / 4 display helpers for per-km line items (`tiered_km`, above-threshold
 * `fixed_below_threshold_then_km`): `BuilderLineItem.unit_price` is **net per km**
 * (so `unit_price × quantity` = line net), but the UI must show the **line net total**.
 */
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';

/** Line net (€) to show in the price column; null if price still missing. */
export function lineItemNetAmountForDisplay(
  item: BuilderLineItem
): number | null {
  if (item.unit_price === null || item.unit_price === undefined) {
    return null;
  }
  if (item.quantity > 1) {
    const n = item.price_resolution.net;
    if (n !== null && n !== undefined) {
      return Math.round(n * 100) / 100;
    }
    return Math.round(item.unit_price * item.quantity * 100) / 100;
  }
  return item.unit_price;
}

/**
 * Total gross for display in the Bruttopreis column (full line incl. Anfahrt VAT).
 * For admin overrides: returns `manualGrossTotal` (always full-line).
 * Otherwise uses net fields only: `price_resolution.gross` is transport-only when
 * Anfahrt lives on `approach_fee_net`, so we must not use it as the display anchor.
 */
export function lineItemGrossTotalForDisplay(
  item: BuilderLineItem
): number | null {
  if (item.manualGrossTotal !== null && item.manualGrossTotal !== undefined) {
    return item.manualGrossTotal;
  }
  if (item.unit_price === null || item.unit_price === undefined) {
    return null;
  }
  const q = item.quantity;
  const approach = item.approach_fee_net ?? 0;
  const transportNet =
    item.price_resolution.net !== null &&
    item.price_resolution.net !== undefined
      ? item.price_resolution.net
      : item.unit_price * q;
  // why: Transport net from resolver (tieredNetTotal); unit × q is display reconstruction.
  // Same idea as lineItemNetAmountForDisplay for quantity > 1. price_resolution.gross
  // omits Anfahrt gross — do not use it as the brutto anchor here.
  return (
    Math.round((transportNet + approach) * (1 + item.tax_rate) * 100) / 100
  );
}

/**
 * Converts the value the user entered in the price cell (always **line net** when
 * `quantity > 1`) back to `unit_price_net` for `updateLineItemPrice`.
 */
export function unitNetFromEditedLineNet(
  item: BuilderLineItem,
  editedLineNet: number
): number {
  if (item.quantity > 1 && item.quantity > 0) {
    return Math.round((editedLineNet / item.quantity) * 100) / 100;
  }
  return editedLineNet;
}
