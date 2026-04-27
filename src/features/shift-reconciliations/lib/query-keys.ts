import { SHIFT_RECONCILIATIONS_QUERY_ROOT } from './constants';

/**
 * Schichtzettel reconciliation — use these keys for useQuery / invalidateQueries
 * so cache shape stays consistent (same pattern as tripKeys).
 */
export const shiftReconciliationKeys = {
  root: [SHIFT_RECONCILIATIONS_QUERY_ROOT] as const,
  trips: (driverId: string, date: string) =>
    [SHIFT_RECONCILIATIONS_QUERY_ROOT, 'trips', driverId, date] as const,
  record: (driverId: string, date: string) =>
    [SHIFT_RECONCILIATIONS_QUERY_ROOT, 'record', driverId, date] as const,
  summaries: (driverId: string) =>
    [SHIFT_RECONCILIATIONS_QUERY_ROOT, 'summaries', driverId] as const
};
