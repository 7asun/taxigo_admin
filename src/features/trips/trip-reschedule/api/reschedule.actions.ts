import { createClient } from '@/lib/supabase/client';
import type { Trip } from '@/features/trips/api/trips.service';
import { findPairedTrip } from '@/features/trips/api/recurring-exceptions.actions';
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

  const { data: primaryRows, error: primaryError } = await supabase
    .from('trips')
    .update(rowFromLeg(primaryLeg))
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
    const { data: partnerRows, error: partnerError } = await supabase
      .from('trips')
      .update(rowFromLeg(partnerLeg))
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
