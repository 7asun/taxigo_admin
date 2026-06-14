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

  /** Berlin `requested_date` window: today + tomorrow (`useTimelessRuleTrips`). */
  timelessRuleTrips: (todayYmd: string, tomorrowYmd: string) =>
    ['trips', 'timeless-rules', todayYmd, tomorrowYmd] as const,

  /**
   * Deferred invoice badge data for the Fahrten list (sorted IDs → stable React Query key).
   * Invalidated with `tripKeys.all` when RSC/list refreshes.
   */
  invoiceStatuses: (tripIds: string[]) =>
    [...tripKeys.all, 'invoiceStatuses', tripIds.slice().sort()] as const,

  /** Per-trip KTS correction rounds (detail timeline — PR2.1). */
  ktsCorrections: (tripId: string) =>
    [...tripKeys.all, 'kts_corrections', tripId] as const,

  /** Per-trip KTS document status (PR3.2 page — reserved). */
  ktsStatus: (tripId: string) =>
    [...tripKeys.detail(tripId), 'kts-status'] as const,

  /**
   * Company-scoped Fahrten “Ansichten” presets (RLS). No company id in key —
   * tenant is implicit from the session.
   */
  presets: () => [...tripKeys.all, 'presets'] as const
};
