import { createClient } from '@/lib/supabase/client';
import type { Trip } from '@/features/trips/api/trips.service';
import { findPairedTrip } from '@/features/trips/api/recurring-exceptions.actions';
import {
  computeTripPrice,
  loadPricingContext,
  resolveTripForPricing,
  shouldRecalculatePrice
} from '@/features/trips/lib/trip-price-engine';
import { canRescheduleTrip, isRecurringTrip } from '../lib/reschedule-trip';

export type RescheduleResult = {
  ok: boolean;
  error?: string;
};

/**
 * One leg’s schedule: either a full pickup datetime, or “Zeitabsprache”
 * (`scheduled_at` null) with an optional calendar day on `requested_date`
 * (same idea as create-trip “Rückfahrt mit Zeitabsprache” and listing filters).
 */
export interface LegScheduleInput {
  scheduledAt: Date | null;
  /** yyyy-MM-dd when `scheduledAt` is null */
  requestedDate: string | null;
}

function rowFromLeg(leg: LegScheduleInput): {
  scheduled_at: string | null;
  requested_date: string | null;
} {
  if (leg.scheduledAt) {
    return {
      scheduled_at: leg.scheduledAt.toISOString(),
      requested_date: null
    };
  }
  return {
    scheduled_at: null,
    requested_date: leg.requestedDate?.trim() || null
  };
}

/**
 * Updates `scheduled_at` / `requested_date` for a non-recurring trip and
 * optionally its paired leg. Pass `partnerLeg` only when a linked trip exists
 * and should be updated.
 */
export async function rescheduleTripWithOptionalPair(
  primary: Trip,
  primaryLeg: LegScheduleInput,
  partnerLeg: LegScheduleInput | null
): Promise<RescheduleResult> {
  if (isRecurringTrip(primary)) {
    return {
      ok: false,
      error: 'Recurring trips cannot be rescheduled in this version.'
    };
  }

  if (!canRescheduleTrip(primary)) {
    return {
      ok: false,
      error: 'This trip cannot be rescheduled.'
    };
  }

  const supabase = createClient();
  const paired = await findPairedTrip(primary);

  if (partnerLeg && !paired) {
    return {
      ok: false,
      error: 'Linked trip could not be loaded for this update.'
    };
  }

  const primaryPatch = rowFromLeg(primaryLeg);
  // Only recalculate when a pricing-relevant field is being changed.
  // Skipping for non-pricing updates avoids unnecessary context loads.
  if (shouldRecalculatePrice(primaryPatch)) {
    const tripInput = await resolveTripForPricing(
      supabase,
      primary.id,
      primaryPatch
    );
    if (tripInput) {
      const context = await loadPricingContext({
        supabase,
        companyId: tripInput.company_id,
        payerId: tripInput.payer_id,
        clientId: tripInput.client_id
      }).catch((e) => {
        // A failed context load must never block a trip save.
        console.error(
          '[trip-price-engine] loadPricingContext failed on reschedule',
          primary.id,
          e
        );
        return null;
      });
      if (context) {
        Object.assign(primaryPatch, computeTripPrice(tripInput, context));
      }
    }
  }

  const { data: primaryRows, error: primaryError } = await supabase
    .from('trips')
    .update(primaryPatch)
    .eq('id', primary.id)
    .select('id');

  if (primaryError) {
    return { ok: false, error: primaryError.message };
  }
  if (!primaryRows?.length) {
    return {
      ok: false,
      error:
        'Update had no effect — check permissions (RLS) or that the trip exists.'
    };
  }

  if (paired && partnerLeg) {
    const partnerPatch = rowFromLeg(partnerLeg);
    if (shouldRecalculatePrice(partnerPatch)) {
      const tripInput = await resolveTripForPricing(
        supabase,
        paired.id,
        partnerPatch
      );
      if (tripInput) {
        const context = await loadPricingContext({
          supabase,
          companyId: tripInput.company_id,
          payerId: tripInput.payer_id,
          clientId: tripInput.client_id
        }).catch((e) => {
          console.error(
            '[trip-price-engine] loadPricingContext failed on reschedule (partner)',
            paired.id,
            e
          );
          return null;
        });
        if (context) {
          Object.assign(partnerPatch, computeTripPrice(tripInput, context));
        }
      }
    }

    const { data: partnerRows, error: partnerError } = await supabase
      .from('trips')
      .update(partnerPatch)
      .eq('id', paired.id)
      .select('id');

    if (partnerError) {
      return { ok: false, error: partnerError.message };
    }
    if (!partnerRows?.length) {
      return {
        ok: false,
        error:
          'Linked trip could not be updated — check permissions (RLS) or that the trip exists.'
      };
    }
  }

  return { ok: true };
}
