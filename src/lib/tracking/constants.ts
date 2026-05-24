// Why: single source of truth for all tracking tunables —
// change intervals or thresholds here only, never in hook or component code

export const TRACKING_UPDATE_INTERVAL_MS = 5_000;
export const TRACKING_SPEED_MS_TO_KMH = 3.6;
export const TRACKING_HIGH_ACCURACY = true;
export const TRACKING_MAX_AGE_MS = 5_000;
export const TRACKING_TIMEOUT_MS = 10_000;
export const TRACKING_OFFLINE_AFTER_MS = 60_000;
export const TRACKING_TABLE = 'live_locations' as const;
export const TRACKING_REALTIME_CHANNEL = 'live-locations-changes' as const;
export const TRACKING_TRIPS_REALTIME_CHANNEL = 'fleet-trips-changes' as const;

// Why: single definition of what "driver has passenger" means —
// includes legacy 'driving' alias for admin/kanban parity
export const TRACKING_BUSY_TRIP_STATUSES = ['in_progress', 'driving'] as const;

export function isTrackingBusyStatus(status: string): boolean {
  return (TRACKING_BUSY_TRIP_STATUSES as readonly string[]).includes(status);
}

// Why: tracking runs during active and on_break — dispatcher needs
// to see driver location during breaks (proximity to next trip)
export const TRACKING_ACTIVE_SHIFT_STATUSES = ['active', 'on_break'] as const;

export function isShiftTrackable(status: string | null | undefined): boolean {
  return (TRACKING_ACTIVE_SHIFT_STATUSES as readonly string[]).includes(
    status ?? ''
  );
}

/** PostgREST embed hint — verify against database.types Relationships after migration. */
export const TRACKING_ACCOUNTS_FK = 'live_locations_driver_id_fkey' as const;
