/**
 * Recurring-rule query keys. Use these factories for `useQuery` and
 * `invalidateQueries` so cache keys stay consistent across the app.
 */

export const recurringKeys = {
  all: ['recurring-rules'] as const,

  /**
   * Dashboard expiry banner: window end = Berlin YMD of today+EXPIRY_WARNING_DAYS.
   * Scopes cache to the calendar day so midnight rollovers bust stale entries.
   */
  expiring: (windowEndYmd: string) =>
    ['recurring-rules', 'expiring', windowEndYmd] as const
};
