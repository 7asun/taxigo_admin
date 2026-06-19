import { describe, expect, test } from 'bun:test';

import {
  buildAssignmentPatch,
  getStatusWhenAssignmentChanges
} from '../trip-assignee';

const PENDING_TRIP = {
  status: 'pending' as const,
  driver_id: null,
  fremdfirma_id: null,
  fremdfirma_payment_mode: null,
  fremdfirma_cost: null
};

const ASSIGNED_DRIVER_TRIP = {
  status: 'assigned' as const,
  driver_id: 'driver-1',
  fremdfirma_id: null,
  fremdfirma_payment_mode: null,
  fremdfirma_cost: null
};

describe('getStatusWhenAssignmentChanges', () => {
  test('pending + driver → assigned', () => {
    expect(
      getStatusWhenAssignmentChanges('pending', {
        driver_id: 'driver-1',
        fremdfirma_id: null
      })
    ).toBe('assigned');
  });

  test('pending + fremdfirma → assigned', () => {
    expect(
      getStatusWhenAssignmentChanges('pending', {
        driver_id: null,
        fremdfirma_id: 'fremd-1'
      })
    ).toBe('assigned');
  });

  test('pending + both null → undefined', () => {
    expect(
      getStatusWhenAssignmentChanges('pending', {
        driver_id: null,
        fremdfirma_id: null
      })
    ).toBeUndefined();
  });

  test('assigned + both null → pending', () => {
    expect(
      getStatusWhenAssignmentChanges('assigned', {
        driver_id: null,
        fremdfirma_id: null
      })
    ).toBe('pending');
  });

  test('assigned + driver → undefined', () => {
    expect(
      getStatusWhenAssignmentChanges('assigned', {
        driver_id: 'driver-1',
        fremdfirma_id: null
      })
    ).toBeUndefined();
  });

  test('terminal status → undefined', () => {
    expect(
      getStatusWhenAssignmentChanges('in_progress', {
        driver_id: null,
        fremdfirma_id: null
      })
    ).toBeUndefined();
  });
});

describe('buildAssignmentPatch', () => {
  test('assign driver from pending promotes status and clears dispatch flag', () => {
    expect(
      buildAssignmentPatch(PENDING_TRIP, { driver_id: 'driver-1' })
    ).toEqual({
      driver_id: 'driver-1',
      fremdfirma_id: null,
      fremdfirma_payment_mode: null,
      fremdfirma_cost: null,
      needs_driver_assignment: false,
      status: 'assigned'
    });
  });

  test('assign fremdfirma from pending clears driver and promotes status', () => {
    expect(
      buildAssignmentPatch(
        { ...PENDING_TRIP, driver_id: 'driver-1' },
        {
          fremdfirma_id: 'fremd-1',
          fremdfirma_payment_mode: 'cash_per_trip',
          fremdfirma_cost: 42
        }
      )
    ).toEqual({
      driver_id: null,
      fremdfirma_id: 'fremd-1',
      fremdfirma_payment_mode: 'cash_per_trip',
      fremdfirma_cost: 42,
      needs_driver_assignment: false,
      status: 'assigned'
    });
  });

  test('remove fremdfirma with no driver reverts to pending', () => {
    expect(
      buildAssignmentPatch(
        {
          status: 'assigned',
          driver_id: null,
          fremdfirma_id: 'fremd-1',
          fremdfirma_payment_mode: 'cash_per_trip',
          fremdfirma_cost: 10
        },
        {
          fremdfirma_id: null,
          fremdfirma_payment_mode: null,
          fremdfirma_cost: null
        }
      )
    ).toEqual({
      driver_id: null,
      fremdfirma_id: null,
      fremdfirma_payment_mode: null,
      fremdfirma_cost: null,
      needs_driver_assignment: true,
      status: 'pending'
    });
  });

  test('unassign driver from assigned driver-only trip reverts to pending', () => {
    expect(
      buildAssignmentPatch(ASSIGNED_DRIVER_TRIP, { driver_id: null })
    ).toEqual({
      driver_id: null,
      fremdfirma_id: null,
      fremdfirma_payment_mode: null,
      fremdfirma_cost: null,
      needs_driver_assignment: true,
      status: 'pending'
    });
  });

  test('in-progress trip: no status in patch', () => {
    const patch = buildAssignmentPatch(
      {
        status: 'in_progress',
        driver_id: 'driver-1',
        fremdfirma_id: null,
        fremdfirma_payment_mode: null,
        fremdfirma_cost: null
      },
      { driver_id: null }
    );
    expect(patch.status).toBeUndefined();
    expect(patch.needs_driver_assignment).toBe(true);
  });
});
