import type { Trip } from '@/features/trips/api/trips.service';

// The three states a trip can be in from an assignee perspective.
// Using 'kind' not 'type' to avoid collision with TypeScript's type keyword.
export type TripAssignee =
  | { kind: 'driver'; id: string; label: string }
  | {
      kind: 'fremdfirma';
      id: string;
      label: string;
      paymentMode: string | null;
    }
  | { kind: 'unassigned'; label: 'Nicht zugewiesen' };

/** Parsed value of the overloaded `driver_id` URL search param. */
export type AssigneeFilterParam =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'driver'; id: string }
  | { kind: 'fremdfirma'; id: string }
  | { kind: 'fremdfirma_all' };

const FREMDFIRMA_PARAM_PREFIX = 'fremdfirma:';
const FREMDFIRMA_ALL_VALUE = 'fremdfirma:all';

/**
 * Parses the overloaded `driver_id` URL param into a typed assignee filter.
 * Keeps query builders free of scattered string checks.
 */
export function parseAssigneeParam(
  driverIdParam: string | null | undefined
): AssigneeFilterParam {
  if (!driverIdParam) {
    return { kind: 'all' };
  }

  if (driverIdParam === 'unassigned') {
    return { kind: 'unassigned' };
  }

  if (driverIdParam === FREMDFIRMA_ALL_VALUE) {
    return { kind: 'fremdfirma_all' };
  }

  if (driverIdParam.startsWith(FREMDFIRMA_PARAM_PREFIX)) {
    const id = driverIdParam.slice(FREMDFIRMA_PARAM_PREFIX.length);
    if (id) {
      return { kind: 'fremdfirma', id };
    }
  }

  return { kind: 'driver', id: driverIdParam };
}

/** Builds the `driver_id` URL value for a Fremdfirma filter option. */
export function formatFremdfirmaAssigneeParam(fremdfirmaId: string): string {
  return `${FREMDFIRMA_PARAM_PREFIX}${fremdfirmaId}`;
}

export const FREMDFIRMA_ALL_ASSIGNEE_PARAM = FREMDFIRMA_ALL_VALUE;

type TripAssigneeInput = {
  driver_id: string | null;
  driver?: { name: string } | null;
  fremdfirma_id: string | null;
  fremdfirma?: {
    name: string;
    default_payment_mode?: string | null;
  } | null;
};

/**
 * Resolves the canonical assignee for any trip row that has been
 * selected with the ASSIGNEE_JOIN_FRAGMENT (see trip-query-fragments.ts).
 * Fremdfirma takes precedence because a trip with both IDs set is always
 * externally delegated — driver_id in that state is a data inconsistency.
 */
export function resolveTripAssignee(trip: TripAssigneeInput): TripAssignee {
  if (trip.fremdfirma_id) {
    return {
      kind: 'fremdfirma',
      id: trip.fremdfirma_id,
      label: trip.fremdfirma?.name ?? 'Fremdfirma',
      paymentMode: trip.fremdfirma?.default_payment_mode ?? null
    };
  }

  if (trip.driver_id) {
    return {
      kind: 'driver',
      id: trip.driver_id,
      label: trip.driver?.name ?? 'Fahrer'
    };
  }

  return { kind: 'unassigned', label: 'Nicht zugewiesen' };
}

/**
 * True only when a trip has no internal driver AND no Fremdfirma.
 * Use this everywhere driver_id IS NULL was used to mean "needs dispatch".
 */
export function isTripUnassignedForDispatch(trip: {
  driver_id: string | null;
  fremdfirma_id: string | null;
}): boolean {
  return trip.driver_id == null && trip.fremdfirma_id == null;
}

/** True when a trip is handled by an external company. */
export function isTripFremdfirma(trip: {
  fremdfirma_id: string | null;
}): boolean {
  return trip.fremdfirma_id != null;
}

// ─── Write model ───────────────────────────────────────────────────────────

export type AssignmentPatchInput = {
  driver_id?: string | null;
  fremdfirma_id?: string | null;
  fremdfirma_payment_mode?: string | null;
  fremdfirma_cost?: number | null;
};

export type AssignmentPatch = {
  driver_id: string | null;
  fremdfirma_id: string | null;
  fremdfirma_payment_mode: string | null;
  fremdfirma_cost: number | null;
  needs_driver_assignment: boolean;
  status?: string;
};

const TERMINAL_STATUSES = new Set([
  'in_progress',
  'driving',
  'completed',
  'cancelled',
  'scheduled'
]);
const ADMIN_OPEN = 'pending';
const ADMIN_ASSIGNED = 'assigned';

function normalizeId(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return value;
}

function hasAssignee(id: string | null): boolean {
  return id != null;
}

/**
 * Derives admin open/assigned status from effective assignee state.
 * `effective` must already reflect the post-change driver_id and fremdfirma_id.
 *
 * Terminal statuses are never modified — Kanban/detail saves must not downgrade
 * in-progress or completed trips when assignee fields are touched incidentally.
 */
export function getStatusWhenAssignmentChanges(
  currentStatus: string,
  effective: { driver_id: string | null; fremdfirma_id: string | null }
): string | undefined {
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return undefined;
  }

  const open = currentStatus === ADMIN_OPEN || currentStatus === 'open';
  const assigned = currentStatus === ADMIN_ASSIGNED;
  const hasDriver = hasAssignee(effective.driver_id);
  const hasFremdfirma = hasAssignee(effective.fremdfirma_id);

  if (open && (hasDriver || hasFremdfirma)) {
    return ADMIN_ASSIGNED;
  }

  if (open && !hasDriver && !hasFremdfirma) {
    return undefined;
  }

  if (assigned && !hasDriver && !hasFremdfirma) {
    return ADMIN_OPEN;
  }

  if (assigned && (hasDriver || hasFremdfirma)) {
    return undefined;
  }

  return undefined;
}

type AssignmentPatchCurrent = Pick<
  Trip,
  | 'status'
  | 'driver_id'
  | 'fremdfirma_id'
  | 'fremdfirma_payment_mode'
  | 'fremdfirma_cost'
>;

/**
 * Builds the canonical trip update payload for assignee changes.
 * Mutual exclusion (driver vs Fremdfirma) is enforced here so call sites cannot forget.
 */
export function buildAssignmentPatch(
  current: AssignmentPatchCurrent,
  next: AssignmentPatchInput
): AssignmentPatch {
  let driver_id = normalizeId(
    next.driver_id !== undefined ? next.driver_id : current.driver_id
  );
  let fremdfirma_id = normalizeId(
    next.fremdfirma_id !== undefined
      ? next.fremdfirma_id
      : current.fremdfirma_id
  );

  let fremdfirma_payment_mode: string | null =
    next.fremdfirma_payment_mode !== undefined
      ? next.fremdfirma_payment_mode
      : (current.fremdfirma_payment_mode ?? null);
  let fremdfirma_cost: number | null =
    next.fremdfirma_cost !== undefined
      ? next.fremdfirma_cost
      : (current.fremdfirma_cost ?? null);

  let needs_driver_assignment: boolean;

  if (fremdfirma_id) {
    // Fremdfirma assignee: internal driver must be cleared.
    driver_id = null;
    needs_driver_assignment = false;
  } else if (driver_id) {
    // Internal driver: clear any stale Fremdfirma billing fields.
    fremdfirma_id = null;
    fremdfirma_payment_mode = null;
    fremdfirma_cost = null;
    needs_driver_assignment = false;
  } else {
    fremdfirma_id = null;
    fremdfirma_payment_mode = null;
    fremdfirma_cost = null;
    needs_driver_assignment = true;
  }

  const patch: AssignmentPatch = {
    driver_id,
    fremdfirma_id,
    fremdfirma_payment_mode,
    fremdfirma_cost,
    needs_driver_assignment
  };

  const derivedStatus = getStatusWhenAssignmentChanges(current.status, {
    driver_id,
    fremdfirma_id
  });
  if (derivedStatus !== undefined) {
    patch.status = derivedStatus;
  }

  return patch;
}
