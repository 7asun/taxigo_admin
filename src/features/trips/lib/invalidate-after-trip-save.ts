import type { QueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import type { UpdateTrip } from '@/features/trips/api/trips.service';

/**
 * Patch keys that change whether a trip appears in dashboard planning widgets
 * (`PendingToursWidget`, `TimelessRuleTripsWidget`). Used by `includePlanningWidgets: 'auto'`.
 */
export const PLANNING_WIDGET_PATCH_KEYS = [
  'scheduled_at',
  'requested_date',
  'status',
  'driver_id',
  'fremdfirma_id',
  'rule_id',
  'linked_trip_id',
  'link_type'
] as const satisfies readonly (keyof UpdateTrip)[];

/** Returns true when `patch` touches any field that affects planning widget membership. */
export function doesPatchAffectPlanningWidgets(
  patch: Partial<UpdateTrip>
): boolean {
  return PLANNING_WIDGET_PATCH_KEYS.some((key) => key in patch);
}

export interface InvalidateAfterTripSaveOptions {
  tripIds?: string | string[];
  patch?: Partial<UpdateTrip> | Array<Partial<UpdateTrip>>;
  /** When false, skips `tripKeys.all` — use when the caller already invalidates the list. */
  includeTripList?: boolean;
  /** `true` always busts widget roots; `'auto'` inspects `patch`; `false` skips them. */
  includePlanningWidgets?: boolean | 'auto';
}

/**
 * Central React Query invalidation contract after a trip write.
 *
 * WHY: save paths previously hand-picked detail, list, and widget keys — sheet saves
 * missed widget roots and left stale rows until reload. Call this once per write site.
 */
export async function invalidateAfterTripSave(
  queryClient: QueryClient,
  options: InvalidateAfterTripSaveOptions = {}
): Promise<void> {
  const {
    tripIds,
    patch,
    includeTripList = true,
    includePlanningWidgets = false
  } = options;

  const ids = tripIds ? (Array.isArray(tripIds) ? tripIds : [tripIds]) : [];

  for (const id of ids) {
    void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
  }

  if (includeTripList) {
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
  }

  let shouldInvalidatePlanningWidgets = false;
  if (includePlanningWidgets === true) {
    shouldInvalidatePlanningWidgets = true;
  } else if (includePlanningWidgets === 'auto') {
    const patches = patch ? (Array.isArray(patch) ? patch : [patch]) : [];
    shouldInvalidatePlanningWidgets = patches.some(
      doesPatchAffectPlanningWidgets
    );
  }

  if (shouldInvalidatePlanningWidgets) {
    void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
    void queryClient.invalidateQueries({
      queryKey: tripKeys.timelessRuleTripsRoot
    });
  }
}
