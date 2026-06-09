/**
 * Normalizes Regelfahrt `end_date` form values for comparisons and API calls.
 * RecurringRuleFormBody uses `<Input type="date">` + Zod string → always `yyyy-MM-dd` or `''`.
 */
export function normalizeRuleEndDate(
  raw: string | null | undefined
): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
