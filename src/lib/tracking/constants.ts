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

/** sessionStorage key for Phase 1 GDPR consent (not persisted to DB until Phase 2). */
export const TRACKING_CONSENT_STORAGE_KEY = 'taxigo_tracking_consent_v1';

/** PostgREST embed hint — verify against database.types Relationships after migration. */
export const TRACKING_ACCOUNTS_FK = 'live_locations_driver_id_fkey' as const;
