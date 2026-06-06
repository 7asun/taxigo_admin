import { tripsService } from '@/features/trips/api/trips.service';
import type {
  BuilderLineItem,
  FailedSyncItem,
  TripWriteBackPatch
} from '@/features/invoices/types/invoice.types';
import { lineItemGrossTotalForDisplay } from '@/features/invoices/lib/line-item-net-display';

/**
 * Trip row patch after invoice save — invoice-confirmed pricing is SSOT for the trip.
 * why: opted-out lines are filtered before calling this — excluded trips must not be overwritten.
 */
export function buildTripWriteBackPatch(
  item: BuilderLineItem
): TripWriteBackPatch {
  const baseNet = item.price_resolution.net;
  const approachNet = item.approach_fee_net ?? 0;
  // why: Bruttopreis column uses combined transport + Anfahrt; price_resolution.gross is transport-only on net-anchor rules.
  const gross =
    item.manualGrossTotal ?? lineItemGrossTotalForDisplay(item) ?? null;

  return {
    gross_price: gross,
    base_net_price: baseNet,
    approach_fee_net: approachNet,
    ...(item.isManualOverride && item.manualGrossTotal !== null
      ? { manual_gross_price: item.manualGrossTotal }
      : {}),
    ...(item.isManualKmOverride && item.manualDistanceKm != null
      ? { manual_distance_km: item.manualDistanceKm }
      : {}),
    ...(item.isManualTaxRateOverride === true
      ? { manual_tax_rate: item.tax_rate }
      : {})
  };
}

function failedSyncItemFromLine(
  item: BuilderLineItem,
  patch: TripWriteBackPatch
): FailedSyncItem {
  return {
    trip_id: item.trip_id!,
    position: item.position,
    client_name: item.client_name,
    line_date: item.line_date,
    gross_price: patch.gross_price,
    tax_rate: item.tax_rate,
    patch
  };
}

/**
 * Writes invoice-confirmed prices to included trip rows. Returns failures with
 * patches frozen at call time for retry (never recomputed from builder state).
 */
export async function executeTripWriteBack(
  items: BuilderLineItem[]
): Promise<FailedSyncItem[]> {
  // why: opted-out trips stay on the invoice for audit but must not overwrite trip pricing.
  const included = items.filter(
    (item) => item.trip_id !== null && item.billingInclusion.included
  );

  const entries = included.map((item) => ({
    item,
    patch: buildTripWriteBackPatch(item)
  }));

  const results = await Promise.allSettled(
    entries.map(({ item, patch }) =>
      tripsService.updateTrip(item.trip_id!, patch)
    )
  );

  const failures: FailedSyncItem[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push(
        failedSyncItemFromLine(entries[index].item, entries[index].patch)
      );
    }
  });

  if (failures.length > 0) {
    // TODO: Future — persist has_sync_warning flag on the invoice row so the
    // dispatcher can reconcile failed trip updates from the invoice list view.
    // See docs/plans/tax-rate-audit.md § write-back failure handling.
    console.error(
      '[write-back] Failed to update trips after invoice save:',
      failures
    );
  }

  return failures;
}

/** Retry failed write-backs using stored patches only. */
export async function retryTripWriteBack(
  items: FailedSyncItem[]
): Promise<FailedSyncItem[]> {
  const results = await Promise.allSettled(
    items.map(({ trip_id, patch }) => tripsService.updateTrip(trip_id, patch))
  );

  const stillFailed: FailedSyncItem[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      stillFailed.push(items[index]);
    }
  });
  return stillFailed;
}
