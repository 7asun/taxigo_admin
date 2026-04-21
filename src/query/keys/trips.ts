/**
 * Trip-related query keys. **Always** use these factories for `useQuery` and
 * `invalidateQueries` so the same key shape is used everywhere (avoids cache misses).
 */

/** Dashboard “Offene Touren” / unplanned trips widget tab filter. */
export type UnplannedTripsFilter = 'today' | 'week' | 'all';

export const tripKeys = {
  all: ['trips'] as const,

  /** Single trip row (matches `getTripById` joins). */
  detail: (tripId: string) => ['trips', 'detail', tripId] as const,

  /**
   * Prefix for all unplanned-trip list queries — use with `invalidateQueries` after a
   * trip write from the widget (or Supabase realtime) so every tab’s cache refetches.
   */
  unplannedRoot: ['trips', 'unplanned'] as const,

  /** One cache entry per dashboard filter tab (`useUnplannedTrips`). */
  unplanned: (filter: UnplannedTripsFilter) =>
    ['trips', 'unplanned', filter] as const,

  /**
   * Prefix for all timeless recurring-rule trips queries — used to refresh the widget
   * after any trip write that could assign a time to a rule-generated leg.
   */
  timelessRuleTripsRoot: ['trips', 'timeless-rules'] as const,

  /** One cache entry per requested_date (`useTimelessRuleTrips`). */
  timelessRuleTrips: (requestedDate: string) =>
    ['trips', 'timeless-rules', requestedDate] as const
};
