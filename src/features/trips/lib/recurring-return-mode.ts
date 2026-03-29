/**
 * Shared recurring-rule Rückfahrt semantics (DB `recurring_rules.return_mode`).
 * Matches create-trip `return_mode` and billing `returnPolicy`.
 */

export type RecurringRuleReturnMode = 'none' | 'time_tbd' | 'exact';

/**
 * `recurring_rule_exceptions.original_pickup_time` is required. For Zeitabsprache-Rückfahrt
 * legs there is no real clock time on the materialized trip (`scheduled_at` null). The cron
 * and skip-occurrence flow use this fixed sentinel so exceptions can still target that leg.
 */
export const RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME = '00:00:00';

export function recurringReturnModeFromRow(rule: {
  return_mode?: string | null;
  return_trip?: boolean | null;
  return_time?: string | null;
}): RecurringRuleReturnMode {
  const rm = rule.return_mode;
  if (rm === 'none' || rm === 'time_tbd' || rm === 'exact') {
    return rm;
  }
  if (!rule.return_trip) {
    return 'none';
  }
  if (rule.return_time && rule.return_time.trim() !== '') {
    return 'exact';
  }
  return 'time_tbd';
}
