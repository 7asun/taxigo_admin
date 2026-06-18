/**
 * Schedule-mode × unit-kind decision layer for trip duplication.
 *
 * WHY this file exists: `executeDuplicateTrips` is a Supabase I/O function. Embedding schedule
 * decisions inline makes it easy for the I/O layer to drift from the payload contract documented
 * in `docs/trips-duplicate.md` and enforced by `parseDuplicateTripsPayload`. Centralising all
 * mode × unit choices here lets tests verify schedule semantics without a live DB connection and
 * lets `executeDuplicateTrips` stay as a thin I/O orchestrator.
 *
 * Primitive helpers (`computePreserveScheduleForLeg`, `computeTimeOpenSchedule`,
 * `computeReturnScheduleForDuplicate`) live in `duplicate-trip-schedule.ts` and are called from
 * here — they are not duplicated or inlined.
 *
 * @see docs/trips-duplicate.md
 */

import {
  computePreserveScheduleForLeg,
  computeReturnScheduleForDuplicate,
  computeTimeOpenSchedule,
  type DuplicateTripsPayload
} from '@/features/trips/lib/duplicate-trip-schedule';
import { instantToYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import type { Trip } from '@/features/trips/api/trips.service';
// WHY import type: DuplicateUnit is declared in duplicate-trips.ts, which will in turn import
// deriveDuplicateSchedules at runtime. Keeping this import type-only erases it at compile output
// and prevents a circular module graph.
import type { DuplicateUnit } from '@/features/trips/lib/duplicate-trips';

export interface DuplicateLegSchedule {
  scheduled_at: string | null;
  requested_date: string | null;
}

export interface DuplicateSchedulesResult {
  outbound: DuplicateLegSchedule;
  /** Present only when unit.kind === 'pair'. Callers must assert non-null before use. */
  return?: DuplicateLegSchedule;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * WHY separated: when the return leg is meant to be open but the outbound leg is timed, the
 * return's `requested_date` must align to the outbound's business calendar day rather than
 * the raw `targetDateYmd` — otherwise Hin (31.) and Rück (30.) can appear on different dates
 * when the outbound ISO crosses a business-day boundary in Europe/Berlin. This invariant is
 * documented in `computeReturnScheduleForDuplicate` and must be preserved here too.
 */
function resolveRequestedDateForOpenReturn(
  outboundSchedule: DuplicateLegSchedule,
  targetDateYmd: string
): DuplicateLegSchedule {
  if (!outboundSchedule.scheduled_at) {
    return { scheduled_at: null, requested_date: targetDateYmd };
  }
  return {
    scheduled_at: null,
    requested_date:
      outboundSchedule.requested_date ??
      instantToYmdInBusinessTz(
        new Date(outboundSchedule.scheduled_at).getTime()
      )
  };
}

/**
 * WHY separated: a standalone trip and a pair outbound have different rules for
 * `unified_time` + missing ISO — singles require an ISO (throw), while pair outbound
 * allows it (detail `explicitPerLegUnifiedTimes`). Keeping them in separate functions
 * prevents accidentally applying one rule to the other.
 */
function deriveSingleLegSchedule(
  sourceLeg: Trip,
  payload: DuplicateTripsPayload
): DuplicateLegSchedule {
  if (payload.scheduleMode === 'time_open') {
    return computeTimeOpenSchedule(payload.targetDateYmd);
  }
  if (payload.scheduleMode === 'unified_time') {
    const iso = payload.unifiedScheduledAtIso;
    if (!iso) {
      throw new Error('Bitte eine Abholzeit festlegen.');
    }
    return {
      scheduled_at: iso,
      requested_date: instantToYmdInBusinessTz(new Date(iso).getTime())
    };
  }
  // preserve_original_time
  return computePreserveScheduleForLeg(sourceLeg, payload.targetDateYmd);
}

/**
 * WHY separated: the outbound leg of a pair has a special `unified_time` rule — a missing
 * outbound ISO is valid when `explicitPerLegUnifiedTimes` is set (detail sheet per-leg path),
 * producing an open outbound instead of throwing. This is intentionally different from the
 * single-leg rule above.
 */
function deriveOutboundSchedule(
  origOutbound: Trip,
  payload: DuplicateTripsPayload
): DuplicateLegSchedule {
  if (payload.scheduleMode === 'time_open') {
    return computeTimeOpenSchedule(payload.targetDateYmd);
  }
  if (payload.scheduleMode === 'unified_time') {
    // Missing outbound ISO is allowed only when `explicitPerLegUnifiedTimes` (detail pair).
    const iso = payload.unifiedScheduledAtIso;
    if (iso) {
      return {
        scheduled_at: iso,
        requested_date: instantToYmdInBusinessTz(new Date(iso).getTime())
      };
    }
    return { scheduled_at: null, requested_date: payload.targetDateYmd };
  }
  // preserve_original_time
  return computePreserveScheduleForLeg(origOutbound, payload.targetDateYmd);
}

/**
 * WHY separated: the return leg has two conflicting interpretations of a missing
 * `unifiedReturnScheduledAtIso` depending on whether `explicitPerLegUnifiedTimes` is set.
 * Isolating this function makes the inversion explicit and prevents the bulk delta path from
 * silently swallowing the detail per-leg open-return intent.
 */
function deriveReturnSchedule(
  origOutbound: Trip,
  origReturn: Trip,
  outboundSchedule: DuplicateLegSchedule,
  payload: DuplicateTripsPayload
): DuplicateLegSchedule {
  // WHY: In the detail-sheet unified-time pair flow (`explicitPerLegUnifiedTimes`),
  // a missing return ISO means "leave this leg open". Bulk unified-time uses a
  // missing return ISO to mean "compute from the Vorlage delta".
  if (
    payload.scheduleMode === 'unified_time' &&
    payload.explicitPerLegUnifiedTimes === true &&
    payload.unifiedReturnScheduledAtIso === undefined
  ) {
    return resolveRequestedDateForOpenReturn(
      outboundSchedule,
      payload.targetDateYmd
    );
  }

  if (
    payload.scheduleMode === 'unified_time' &&
    payload.unifiedReturnScheduledAtIso
  ) {
    const retIso = payload.unifiedReturnScheduledAtIso;
    const retMs = new Date(retIso).getTime();
    return {
      scheduled_at: retIso,
      requested_date: instantToYmdInBusinessTz(retMs)
    };
  }

  return computeReturnScheduleForDuplicate(
    origOutbound,
    origReturn,
    outboundSchedule,
    payload.scheduleMode,
    payload.targetDateYmd,
    payload.unifiedScheduledAtIso
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalises a validated payload + partitioned unit into insert-ready schedules.
 *
 * WHY exported as a pure function: all schedule-mode × unit-kind decisions are owned here,
 * not in `executeDuplicateTrips`. This makes the decision contract testable without Supabase
 * and prevents the I/O layer from drifting from the semantics documented in
 * `docs/trips-duplicate.md` and validated by `parseDuplicateTripsPayload`.
 *
 * Contract:
 * - `result.return` is present if and only if `unit.kind === 'pair'`.
 * - For single units, `result.return` is always undefined.
 * - For pair units, callers must assert `result.return` non-null before use.
 */
export function deriveDuplicateSchedules(
  payload: DuplicateTripsPayload,
  unit: DuplicateUnit
): DuplicateSchedulesResult {
  if (unit.kind === 'single') {
    return { outbound: deriveSingleLegSchedule(unit.trip, payload) };
  }

  const outbound = deriveOutboundSchedule(unit.outbound, payload);
  const ret = deriveReturnSchedule(unit.outbound, unit.ret, outbound, payload);
  return { outbound, return: ret };
}
