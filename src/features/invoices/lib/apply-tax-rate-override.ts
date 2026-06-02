import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';
import { resolveTaxRate } from '@/features/invoices/lib/tax-calculator';
import {
  applyGrossOverrideToResolution,
  resolveTripPrice as resolveTripPricePure,
  type TripPriceInput
} from '@/features/invoices/lib/resolve-trip-price';
function tripInputForReprice(item: BuilderLineItem): TripPriceInput {
  return {
    kts_document_applies: item.kts_document_applies,
    net_price: null,
    base_net_price: null,
    manual_gross_price:
      item.price_resolution.source === 'manual_gross_price' &&
      item.price_resolution.gross != null
        ? item.price_resolution.gross
        : null,
    driving_distance_km: item.effective_distance_km,
    scheduled_at: item.line_date,
    client: undefined
  };
}

function isGrossAnchorTaxReprice(item: BuilderLineItem): boolean {
  const src = item.price_resolution.source;
  return (
    src === 'manual_gross_price' ||
    src === 'client_price_tag' ||
    item.isManualOverride === true
  );
}

/**
 * Reprices a builder line when the dispatcher changes MwSt in Step 3.
 * Gross-anchor lines keep agreed brutto; net-anchor lines keep transport net and float gross.
 */
export function patchLineItemForTaxRateOverride(
  item: BuilderLineItem,
  newRate: number
): BuilderLineItem {
  const autoRate = resolveTaxRate(item.effective_distance_km).rate;
  const isManualTaxRateOverride = newRate !== autoRate;

  if (item.kts_override) {
    const patched: BuilderLineItem = {
      ...item,
      tax_rate: newRate,
      price_resolution: { ...item.price_resolution, tax_rate: newRate },
      isManualTaxRateOverride
    };
    return patched;
  }

  if (isGrossAnchorTaxReprice(item)) {
    if (item.isManualOverride && item.manualGrossTotal != null) {
      const approachGross =
        item.manualApproachFeeGross ??
        (item.approach_fee_net != null
          ? Math.round(item.approach_fee_net * (1 + item.tax_rate) * 100) / 100
          : 0);
      const nextRes = applyGrossOverrideToResolution(
        item.price_resolution,
        item.manualGrossTotal,
        approachGross,
        newRate
      );
      return {
        ...item,
        tax_rate: newRate,
        unit_price: nextRes.unit_price_net,
        approach_fee_net: nextRes.approach_fee_net ?? null,
        approach_fee_gross: approachGross,
        price_resolution: nextRes,
        isManualTaxRateOverride
      };
    }

    const pr = item.price_resolution;
    const grossFixed = pr.gross as number;
    // why: taxameter / client tag brutto is contractual — only net floats when rate changes.
    const transportNet = grossFixed / (1 + newRate);
    const approachNet = pr.approach_fee_net ?? 0;
    const nextRes = {
      ...pr,
      net: transportNet,
      gross: grossFixed,
      tax_rate: newRate,
      unit_price_net:
        item.quantity > 1 ? transportNet / item.quantity : transportNet
    };
    const approachGross =
      approachNet > 0
        ? Math.round(approachNet * (1 + newRate) * 100) / 100
        : null;
    return {
      ...item,
      tax_rate: newRate,
      unit_price: nextRes.unit_price_net,
      approach_fee_net: approachNet > 0 ? approachNet : null,
      approach_fee_gross: approachGross,
      price_resolution: nextRes,
      isManualTaxRateOverride
    };
  }

  // why: net-anchor — payer benefits from exemption; transport net stays, gross floats with rate.
  const newPriceResolution = item.resolved_rule
    ? resolveTripPricePure(
        tripInputForReprice(item),
        newRate,
        item.resolved_rule
      )
    : {
        ...item.price_resolution,
        tax_rate: newRate
      };

  const nextApproachNet = newPriceResolution.approach_fee_net ?? null;
  return {
    ...item,
    tax_rate: newRate,
    unit_price: newPriceResolution.unit_price_net ?? item.unit_price,
    quantity: newPriceResolution.quantity,
    approach_fee_net: nextApproachNet,
    approach_fee_gross:
      nextApproachNet != null
        ? Math.round(nextApproachNet * (1 + newRate) * 100) / 100
        : null,
    price_resolution: newPriceResolution,
    kts_override: newPriceResolution.strategy_used === 'kts_override',
    isManualTaxRateOverride
  };
}

export function resetLineItemTaxRateOverride(
  item: BuilderLineItem
): BuilderLineItem {
  const autoRate = resolveTaxRate(item.effective_distance_km).rate;
  const patched = patchLineItemForTaxRateOverride(item, autoRate);
  return { ...patched, isManualTaxRateOverride: false };
}
