'use client';

import { useCallback } from 'react';

import type { UpdateTrip } from '../api/trips.service';
import { useUpdateTripMutation } from './use-update-trip-mutation';

/**
 * Single-field trip updates with the same invalidation + pending semantics as
 * `useUpdateTripMutation`. Use this for simple grid cells; for multi-field
 * atomic patches call `useUpdateTripMutation` directly and note why at the call site.
 */
export function useTripFieldUpdate() {
  const { mutate, isPending } = useUpdateTripMutation();

  const updateField = useCallback(
    <K extends keyof UpdateTrip>(
      tripId: string,
      field: K,
      value: UpdateTrip[K]
    ) => {
      mutate({ id: tripId, patch: { [field]: value } as UpdateTrip });
    },
    [mutate]
  );

  return { updateField, isPending };
}
