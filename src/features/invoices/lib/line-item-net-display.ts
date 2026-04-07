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
