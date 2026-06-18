import {
  createRecurringRule,
  deleteFutureTripsAfterDate,
  resyncFutureRecurringTrips,
  triggerGenerationForRule,
  updateRecurringRule
} from '@/features/trips/api/recurring-rules.actions';
import {
  recurringRulesService,
  type RecurringRule,
  type UpdateRecurringRule
} from '@/features/trips/api/recurring-rules.service';
import { RECURRING_TRIP_GENERATION_HORIZON_DAYS } from '@/lib/recurring-trip-generator';
import { normalizeRuleEndDate } from './normalize-rule-end-date';

/**
 * Returns true if the incoming payload changes any field that affects the
 * computed `scheduled_at` on already-materialised recurring trips.
 *
 * WHY only these three: `pickup_time`, `return_time`, and `return_mode` are the
 * only rule fields that feed into `scheduled_at` at trip generation time. Billing,
 * address, payer, and date-range fields do not affect the UTC instant stored on
 * trips — address changes are handled separately (geocoding); billing changes are
 * irrelevant to resync.
 *
 * Only compares fields that are present in the payload to remain safe for partial
 * `UpdateRecurringRule` callers (full Panel/Sheet saves always include all three).
 */
export function hasScheduleChange(
  existing: RecurringRule,
  payload: UpdateRecurringRule
): boolean {
  const norm = (t: string | null | undefined): string | null =>
    t?.trim() ?? null;
  if (
    payload.pickup_time !== undefined &&
    norm(payload.pickup_time) !== norm(existing.pickup_time)
  ) {
    return true;
  }
  if (
    payload.return_time !== undefined &&
    norm(payload.return_time) !== norm(existing.return_time)
  ) {
    return true;
  }
  if (
    payload.return_mode !== undefined &&
    payload.return_mode !== existing.return_mode
  ) {
    return true;
  }
  return false;
}

export function isEndDateShortening(
  oldEndRaw: string | null | undefined,
  newEndRaw: string | null | undefined
): { isShortening: boolean; oldEnd: string | null; newEnd: string | null } {
  // type='date' + Zod string → yyyy-MM-dd; normalize empty → null
  const oldEnd = normalizeRuleEndDate(oldEndRaw);
  const newEnd = normalizeRuleEndDate(newEndRaw);
  const isShortening = oldEnd != null && newEnd != null && newEnd < oldEnd;
  return { isShortening, oldEnd, newEnd };
}

export async function countTripsForShorten(
  ruleId: string,
  newEnd: string
): Promise<number> {
  return recurringRulesService.countFutureTripsAfterDate(ruleId, newEnd);
}

export async function runCreateWithGeneration(
  payload: Parameters<typeof createRecurringRule>[0]
): Promise<{
  ruleId: string;
  generated: number;
  generationError: string | null;
}> {
  const { data, error } = await createRecurringRule(payload);
  if (error || !data) {
    throw new Error(error ?? 'Regel konnte nicht erstellt werden');
  }

  const gen = await triggerGenerationForRule(data.id);
  return {
    ruleId: data.id,
    generated: gen.generated,
    generationError: gen.error
  };
}

/**
 * Updates a recurring rule, optionally deletes future trips beyond a shortened
 * end date, and resyncs `scheduled_at` on future pending trips when schedule
 * fields change.
 *
 * WHY existingRule is optional: callers that do not have the pre-update rule
 * state (e.g. handleShortenConfirm, legacy consumers) pass only 3 args and
 * behave identically to the previous implementation — resync is simply skipped.
 * This keeps the change backwards-compatible with no call-site breakage.
 *
 * WHY resync is gated on hasScheduleChange: rewriting `scheduled_at` on every
 * save — even when only billing or address changed — would be wasteful and would
 * overwrite any dispatcher-adjusted times. We only touch trips when the
 * schedule clock actually changed.
 */
export async function runUpdateWithCleanup(
  ruleId: string,
  payload: UpdateRecurringRule,
  newEnd: string | null,
  existingRule?: RecurringRule
): Promise<{ deleted: number; resynced: number }> {
  let deleted = 0;

  if (newEnd) {
    const { deleted: n, error } = await deleteFutureTripsAfterDate(
      ruleId,
      newEnd
    );
    if (error) {
      throw new Error(error);
    }
    deleted = n;
  }

  const { error: updateError } = await updateRecurringRule(ruleId, payload);
  if (updateError) {
    throw new Error(updateError);
  }

  let resynced = 0;

  if (existingRule && hasScheduleChange(existingRule, payload)) {
    // Pass existingRule as priorRule — exception keys were stamped using the
    // pre-update rule times and must be matched with those same values.
    // payload.return_mode ?? existingRule.return_mode: defensive fallback for
    // partial UpdateRecurringRule callers; buildRecurringRulePayload (UI saves)
    // always includes return_mode, so the fallback does not trigger in practice.
    const result = await resyncFutureRecurringTrips(
      ruleId,
      {
        pickup_time: payload.pickup_time ?? null,
        return_time: payload.return_time ?? null,
        return_mode: payload.return_mode ?? existingRule.return_mode
      },
      existingRule
    );
    resynced = result.resynced;
  }

  return { deleted, resynced };
}

export function generationHorizonDays(): number {
  return RECURRING_TRIP_GENERATION_HORIZON_DAYS;
}
