/**
 * End-date shorten cleanup predicate — must stay identical in
 * `countFutureTripsAfterDate` (browser service) and `deleteFutureTripsAfterDate`
 * (server action). Differs intentionally from `deleteRule`'s broader teardown filter.
 *
 * Predicate:
 *   rule_id = ruleId
 *   requested_date > afterYmd   (strictly after new end_date; trip ON end_date kept)
 *   status = 'pending'
 *
 * WHY rule_id alone scopes recurring trips: any row with rule_id set belongs to
 * that Regelfahrt. `ingestion_source` is not queried — the column does not exist
 * in the live DB (types may be ahead of production).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEndDateShortenCleanupFilters<
  Q extends { eq: any; gt: any }
>(query: Q, ruleId: string, afterYmd: string): Q {
  return query
    .eq('rule_id', ruleId)
    .gt('requested_date', afterYmd)
    .eq('status', 'pending');
}
