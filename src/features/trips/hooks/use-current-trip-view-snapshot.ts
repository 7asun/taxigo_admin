'use client';

import type { VisibilityState } from '@tanstack/react-table';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import {
  isTripPresetParamKey,
  type TripPresetParams
} from '@/features/trips/types/trip-preset.types';

/**
 * Pagination is not part of a saved “Ansicht” — presets represent filters + columns only.
 */
const EXCLUDED_PRESET_PARAM_KEYS = ['page', 'perPage'] as const;

export function buildTripPresetParamsFromSearchParams(
  searchParams: ReadonlyURLSearchParams | URLSearchParams
): TripPresetParams {
  const params: TripPresetParams = {};
  searchParams.forEach((value, key) => {
    if (
      (EXCLUDED_PRESET_PARAM_KEYS as readonly string[]).includes(key) ||
      !isTripPresetParamKey(key)
    ) {
      return;
    }
    if (value !== '') {
      (params as Record<string, string>)[key] = value;
    }
  });
  return params;
}

/**
 * Caller supplies `searchParams` / `columnVisibility` / `columnOrder` so this hook does not
 * double-subscribe — mirror values come from the same sources as `AnsichtenDropdown`.
 */
export function useCurrentTripViewSnapshot(
  searchParams: ReadonlyURLSearchParams,
  columnVisibility: VisibilityState,
  columnOrder: string[]
) {
  return useCallback(() => {
    return {
      params: buildTripPresetParamsFromSearchParams(searchParams),
      column_visibility: { ...columnVisibility } as VisibilityState,
      column_order: [...columnOrder]
    };
  }, [searchParams, columnVisibility, columnOrder]);
}
