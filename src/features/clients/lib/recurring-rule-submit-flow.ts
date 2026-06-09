import {
  createRecurringRule,
  deleteFutureTripsAfterDate,
  triggerGenerationForRule,
  updateRecurringRule
} from '@/features/trips/api/recurring-rules.actions';
import {
  recurringRulesService,
  type UpdateRecurringRule
} from '@/features/trips/api/recurring-rules.service';
import { RECURRING_TRIP_GENERATION_HORIZON_DAYS } from '@/lib/recurring-trip-generator';
import { normalizeRuleEndDate } from './normalize-rule-end-date';

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

export async function runUpdateWithCleanup(
  ruleId: string,
  payload: UpdateRecurringRule,
  newEnd: string | null
): Promise<{ deleted: number }> {
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

  return { deleted };
}

export function generationHorizonDays(): number {
  return RECURRING_TRIP_GENERATION_HORIZON_DAYS;
}
