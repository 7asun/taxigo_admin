/**
 * GoTrue admin ban_duration values — use with auth.admin.updateUserById only (service role).
 * Year suffixes like `100y` are rejected; hours are supported.
 */

/** Permanent ban (~100 years). */
export const AUTH_BAN_DURATION_PERMANENT = '876000h' as const;

/** Clears ban so the user can sign in again. */
export const AUTH_BAN_DURATION_UNBAN = '0s' as const;
