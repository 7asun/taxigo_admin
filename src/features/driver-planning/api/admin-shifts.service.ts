/**
 * Admin shift writes — server-only Supabase access for payroll actuals.
 *
 * WHY separate from shifts.service.ts: browser client runs under driver session;
 * admin writes require server client + requireAdminContext() RLS boundary.
 */

import {
  SHIFT_EVENT_TYPES,
  SHIFT_STATUSES
} from '@/features/driver-portal/types';
import { getZonedDayBoundsIso } from '@/features/trips/lib/trip-business-date';
import {
  buildScheduledAt,
  parseScheduledAtOrFallback
} from '@/features/trips/lib/trip-time';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type { AdminShiftForDate, CreateAdminShiftPayload } from '../types';
import { requireAdminContext } from './driver-planning.service';

type ShiftEventRow = {
  event_type: string;
  timestamp: string | null;
};

function sortEventsByTimestamp(events: ShiftEventRow[]): ShiftEventRow[] {
  return [...events].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
}

/**
 * Zip adjacent break_start / break_end pairs in timestamp order.
 * Unmatched break_start or orphan break_end are skipped (partial live breaks).
 */
function parseBreaksFromEvents(events: ShiftEventRow[]): Array<{
  start: string;
  end: string;
}> {
  const ordered = sortEventsByTimestamp(events);
  const breaks: Array<{ start: string; end: string }> = [];

  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i];
    if (current.event_type !== SHIFT_EVENT_TYPES.BREAK_START) continue;

    const next = ordered[i + 1];
    if (!next || next.event_type !== SHIFT_EVENT_TYPES.BREAK_END) continue;

    const startParsed = parseScheduledAtOrFallback(current.timestamp);
    const endParsed = parseScheduledAtOrFallback(next.timestamp);
    if (!startParsed || !endParsed) continue;

    breaks.push({ start: startParsed.hm, end: endParsed.hm });
    i += 1;
  }

  return breaks;
}

function mapShiftRowToAdminShift(row: {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  vehicle_id: string | null;
  shift_events: ShiftEventRow[] | null;
}): AdminShiftForDate {
  const events = row.shift_events ?? [];
  const startParsed = parseScheduledAtOrFallback(row.started_at);
  const endParsed = parseScheduledAtOrFallback(row.ended_at);

  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    vehicleId: row.vehicle_id,
    startTime: startParsed?.hm ?? '08:00',
    endTime: endParsed?.hm ?? '17:00',
    breaks: parseBreaksFromEvents(events)
  };
}

async function findShiftForDriverDate(
  driverId: string,
  date: string
): Promise<{
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  vehicle_id: string | null;
  shift_events: ShiftEventRow[] | null;
} | null> {
  const { supabase, companyId } = await requireAdminContext();
  const { startISO, endExclusiveISO } = getZonedDayBoundsIso(date);

  const { data, error } = await supabase
    .from('shifts')
    .select(
      `
      id,
      status,
      started_at,
      ended_at,
      vehicle_id,
      shift_events (
        event_type,
        timestamp
      )
    `
    )
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .gte('started_at', startISO)
    .lt('started_at', endExclusiveISO)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!data) return null;

  return data as {
    id: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    vehicle_id: string | null;
    shift_events: ShiftEventRow[] | null;
  };
}

export async function getAdminShiftForDriverDate(
  driverId: string,
  date: string
): Promise<AdminShiftForDate | null> {
  const row = await findShiftForDriverDate(driverId, date);
  if (!row) return null;
  return mapShiftRowToAdminShift(row);
}

async function deleteShiftAndEvents(shiftId: string): Promise<void> {
  const { supabase, companyId } = await requireAdminContext();

  const { data: shift, error: fetchError } = await supabase
    .from('shifts')
    .select('id')
    .eq('id', shiftId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (fetchError) throw toQueryError(fetchError);
  if (!shift) throw new Error('SHIFT_NOT_FOUND');

  // WHY sequential deletes: MVP overwrite path — partial failure could leave orphan
  // events; harden with Supabase RPC/transaction in Phase 4B.
  const { error: eventsError } = await supabase
    .from('shift_events')
    .delete()
    .eq('shift_id', shiftId);
  if (eventsError) throw toQueryError(eventsError);

  const { error: shiftError } = await supabase
    .from('shifts')
    .delete()
    .eq('id', shiftId);
  if (shiftError) throw toQueryError(shiftError);
}

export async function createAdminShiftForDriver(
  params: CreateAdminShiftPayload
): Promise<{ shiftId: string }> {
  const { supabase, companyId, userId } = await requireAdminContext();

  const existing = await findShiftForDriverDate(params.driverId, params.date);

  // D2 product rule — admin cannot overwrite a live shift; driver may be on the road.
  if (existing && existing.status !== SHIFT_STATUSES.ENDED) {
    throw new Error('ACTIVE_SHIFT_BLOCKED');
  }

  if (existing && existing.status === SHIFT_STATUSES.ENDED) {
    await deleteShiftAndEvents(existing.id);
  }

  // WHY buildScheduledAt: Berlin wall-clock → UTC ISO; must match getZonedDayBoundsIso
  // for duplicate detection and the DB unique index on Berlin calendar date.
  const startedAt = buildScheduledAt(params.date, params.startTime);
  const endedAt = buildScheduledAt(params.date, params.endTime);

  const { data: shift, error: shiftError } = await supabase
    .from('shifts')
    .insert({
      driver_id: params.driverId,
      company_id: companyId,
      vehicle_id: params.vehicleId ?? null,
      started_at: startedAt,
      ended_at: endedAt,
      status: SHIFT_STATUSES.ENDED,
      // D1 product rule — audit trail for payroll disputes when admin enters on behalf.
      entered_by: userId
    })
    .select('id')
    .single();

  if (shiftError) throw toQueryError(shiftError);

  const insertEvent = async (
    eventType: string,
    timestamp: string,
    metadata?: Record<string, unknown> | null
  ) => {
    const { error } = await supabase.from('shift_events').insert({
      shift_id: shift.id,
      event_type: eventType,
      timestamp,
      lat: null,
      lng: null,
      metadata: metadata ?? null
    });
    if (error) throw toQueryError(error);
  };

  await insertEvent(SHIFT_EVENT_TYPES.SHIFT_START, startedAt);

  const breaks = params.breaks ?? [];
  for (const br of breaks) {
    if (!br.start || !br.end) continue;
    const breakStartTs = buildScheduledAt(params.date, br.start);
    const breakEndTs = buildScheduledAt(params.date, br.end);
    await insertEvent(SHIFT_EVENT_TYPES.BREAK_START, breakStartTs, {
      reason: 'Pause'
    });
    await insertEvent(SHIFT_EVENT_TYPES.BREAK_END, breakEndTs);
  }

  await insertEvent(SHIFT_EVENT_TYPES.SHIFT_END, endedAt);

  return { shiftId: shift.id };
}

/**
 * Removes admin-entered shift for a driver on a Berlin calendar day.
 * Idempotent when no shift exists. Events deleted explicitly (no ON DELETE CASCADE on shift_events.shift_id).
 */
export async function deleteAdminShift(
  driverId: string,
  date: string
): Promise<void> {
  const { supabase, companyId } = await requireAdminContext();
  const { startISO, endExclusiveISO } = getZonedDayBoundsIso(date);

  const { data: shift, error } = await supabase
    .from('shifts')
    .select('id')
    .eq('driver_id', driverId)
    .eq('company_id', companyId)
    .gte('started_at', startISO)
    .lt('started_at', endExclusiveISO)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!shift) return;

  await deleteShiftAndEvents(shift.id);
}
